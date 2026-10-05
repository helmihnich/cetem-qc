import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "@cetem-qc/api-client/v1";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import type { LocalDraft } from "../local-drafts/model.js";
import { createAppSyncTransport, SYNC_REQUEST_TIMEOUT_MS } from "./app-sync-transport.js";
import type { SyncRequest } from "./sync-engine.js";

// Story 7.3 replaces the 7.2 « no transport » contract: the App transport is the HTTP adapter.

const taskId = "00000000-0000-4000-8000-000000000071";
const operationId = "00000000-0000-4000-8000-000000000072";
const actor = { id: "00000000-0000-4000-8000-000000000073", displayName: "Employé Test" };
const snapshot: LocalDraft = {
  id: "draft-1", employeeId: actor.id, taskId, payloadSchemaVersion: 1, revision: 3, createdAt: 1_000, savedAt: Date.UTC(2026, 9, 4, 8, 0, 0),
  payload: { ...GRAPHIE_CALCULATION_IDENTITY, values: { "header.reportNumber": "R-1", "lightField.gap1": "abc" } },
};
const request = (kind: SyncRequest["kind"] = "submit"): SyncRequest => ({
  operationId, idempotencyKey: "00000000-0000-4000-8000-000000000074", kind, employeeId: actor.id, taskId, baseRevision: 2, snapshot,
});

type FetchCall = { url: string; init?: RequestInit };
function transportFor(respond: (call: FetchCall) => Promise<{ status: number; body?: unknown; unreadable?: boolean }>) {
  const calls: FetchCall[] = [];
  const api = createApiClient({
    baseUrl: "https://cetem-qc.example.test",
    sessionToken: "session-token",
    fetch: async (input, init) => {
      const call = { url: String(input), init };
      calls.push(call);
      const reply = await respond(call);
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => { if (reply.unreadable) throw new SyntaxError("Unexpected token"); return reply.body; },
      } as Response;
    },
  });
  return { calls, transport: createAppSyncTransport(api) };
}

const apiError = (code: string) => ({ error: { code, message: "Message." } });
const acceptedBody = { outcome: "accepted", operationId, kind: "submit", serverRevision: 3, acceptedAt: "2026-10-04T08:00:05.000Z", acceptedBy: actor, submissionId: "00000000-0000-4000-8000-000000000075" };
const current = { revision: 5, state: "draft", lastChangedAt: "2026-10-04T07:00:00.000Z", lastChangedBy: actor };

test("T1 every response maps to its SyncResult, and only a schema-valid 200 is accepted", async () => {
  const cases: Array<[{ status: number; body?: unknown; unreadable?: boolean } | "network", unknown]> = [
    [{ status: 200, body: acceptedBody }, { type: "accepted", serverRevision: 3, detail: { acceptedAt: acceptedBody.acceptedAt, acceptedBy: actor, submissionId: acceptedBody.submissionId } }],
    [{ status: 409, body: { outcome: "conflict", operationId, kind: "submit", serverRevision: 5, current } }, { type: "conflict", serverRevision: 5, detail: current }],
    [{ status: 422, body: { outcome: "rejected", operationId, kind: "submit", code: "INVALID_PAYLOAD", message: "Les données du contrôle sont invalides.", issues: [{ path: "values.x", code: "unknown-field" }] } },
      { type: "rejected", detail: { code: "INVALID_PAYLOAD", issues: [{ path: "values.x", code: "unknown-field" }] } }],
    ["network", { type: "retryable", code: "network-error" }],
    [{ status: 408, body: apiError("REQUEST_TIMEOUT") }, { type: "retryable", code: "HTTP_408" }],
    [{ status: 429, body: apiError("TOO_MANY_REQUESTS") }, { type: "retryable", code: "HTTP_429" }],
    [{ status: 500, body: apiError("INTERNAL_ERROR") }, { type: "retryable", code: "HTTP_500" }],
    [{ status: 503, unreadable: true }, { type: "retryable", code: "HTTP_503" }],
    [{ status: 400, body: apiError("VALIDATION_ERROR") }, { type: "blocking", code: "VALIDATION_ERROR" }],
    [{ status: 401, body: apiError("AUTHENTICATION_FAILED") }, { type: "blocking", code: "AUTHENTICATION_FAILED" }],
    [{ status: 403, body: apiError("FORBIDDEN") }, { type: "blocking", code: "FORBIDDEN" }],
    [{ status: 404, body: apiError("TASK_NOT_FOUND") }, { type: "blocking", code: "TASK_NOT_FOUND" }],
    [{ status: 413, body: apiError("PAYLOAD_TOO_LARGE") }, { type: "blocking", code: "PAYLOAD_TOO_LARGE" }],
    [{ status: 422, body: apiError("IDEMPOTENCY_KEY_REUSED") }, { type: "blocking", code: "IDEMPOTENCY_KEY_REUSED" }],
    [{ status: 200, body: { ...acceptedBody, outcome: "rejected" } }, { type: "blocking", code: "HTTP_200" }],
    [{ status: 200, body: { ok: true } }, { type: "blocking", code: "HTTP_200" }],
    [{ status: 200, unreadable: true }, { type: "blocking", code: "HTTP_200" }],
    [{ status: 201, body: acceptedBody }, { type: "blocking", code: "HTTP_201" }],
    [{ status: 418, body: "teapot" }, { type: "blocking", code: "HTTP_418" }],
  ];
  for (const [reply, expected] of cases) {
    const { transport } = transportFor(async () => { if (reply === "network") throw new TypeError("Network request failed"); return reply; });
    assert.deepEqual(await transport.send(request()), expected, JSON.stringify(reply));
  }
});

test("T1 a result never carries payload values", async () => {
  const { transport } = transportFor(async () => ({ status: 200, body: acceptedBody }));
  assert.equal(JSON.stringify(await transport.send(request())).includes("R-1"), false);
});

test("T2 the envelope matches the queued request and the route follows the kind", async () => {
  const { calls, transport } = transportFor(async () => ({ status: 200, body: acceptedBody }));
  await transport.send(request("submit"));
  await transport.send(request("sync-draft"));
  assert.equal(calls[0]!.url, `https://cetem-qc.example.test/api/v1/employee/tasks/${taskId}/submissions`);
  assert.equal(calls[1]!.url, `https://cetem-qc.example.test/api/v1/employee/tasks/${taskId}/draft-syncs`);
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, "Bearer session-token");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    operationId, idempotencyKey: "00000000-0000-4000-8000-000000000074", baseRevision: 2, localDraftRevision: 3,
    clientSavedAt: "2026-10-04T08:00:00.000Z", payload: snapshot.payload,
  });
  assert.ok(calls[0]!.init?.signal instanceof AbortSignal);
});

test("T3 a request without an answer is aborted after 30 s and is retryable", async () => {
  let fire: (() => void) | undefined;
  let scheduled = 0;
  let cleared = 0;
  const timers = {
    setTimeout: (callback: () => void, ms: number) => { scheduled = ms; fire = callback; return 1; },
    clearTimeout: () => { cleared++; },
  };
  const api = createApiClient({
    baseUrl: "https://cetem-qc.example.test",
    sessionToken: "session-token",
    fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  });
  const pending = createAppSyncTransport(api, timers).send(request());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduled, SYNC_REQUEST_TIMEOUT_MS);
  assert.equal(SYNC_REQUEST_TIMEOUT_MS, 30_000);
  fire!();
  assert.deepEqual(await pending, { type: "retryable", code: "timeout" });
  assert.equal(cleared, 1);
});

test("an envelope that cannot be built from the snapshot blocks instead of retrying", async () => {
  const { calls, transport } = transportFor(async () => ({ status: 200, body: acceptedBody }));
  assert.deepEqual(await transport.send({ ...request(), operationId: "not-a-uuid" }), { type: "blocking", code: "INVALID_REQUEST" });
  assert.equal(calls.length, 0);
});

test("T4 the conflict reference is sent only when the request carries it", async () => {
  const { calls, transport } = transportFor(async () => ({ status: 200, body: { ...acceptedBody, kind: "sync-draft", submissionId: undefined } }));
  const conflictOperationId = "00000000-0000-4000-8000-000000000076";
  await transport.send({ ...request("sync-draft"), conflictOperationId });
  await transport.send(request("sync-draft"));
  assert.equal(JSON.parse(String(calls[0]!.init?.body)).conflictOperationId, conflictOperationId);
  assert.equal("conflictOperationId" in JSON.parse(String(calls[1]!.init?.body)), false);
});

test("T5 the correction reference is sent only when the request carries it", async () => {
  const { calls, transport } = transportFor(async () => ({ status: 200, body: acceptedBody }));
  const correctionOfOperationId = "00000000-0000-4000-8000-000000000082";
  await transport.send({ ...request(), correctionOfOperationId });
  await transport.send(request());
  assert.equal(JSON.parse(String(calls[0]!.init?.body)).correctionOfOperationId, correctionOfOperationId);
  assert.equal("correctionOfOperationId" in JSON.parse(String(calls[1]!.init?.body)), false);
});
