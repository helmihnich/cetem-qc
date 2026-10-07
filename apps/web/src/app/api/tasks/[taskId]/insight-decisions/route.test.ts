import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.js";

const originalFetch = globalThis.fetch;
const token = "opaque-session-token-value-not-for-the-browser";
const taskId = "00000000-0000-4000-8000-000000000040";
const context = { params: Promise.resolve({ taskId }) };
const url = `http://localhost/api/tasks/${taskId}/insight-decisions`;
const body = JSON.stringify({ proposalId: "rule-a:v1:sub:field=x", decision: "retained" });

test("W17 insight-decision proxy rejects cross-origin or origin-less requests without forwarding", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const rejected: Array<Record<string, string>> = [{ cookie: `cetem_qc_session=${token}` }, { cookie: `cetem_qc_session=${token}`, origin: "https://evil.example.test" }];
    for (const headers of rejected) {
      const response = await POST(new Request(url, { method: "POST", headers, body }), context);
      assert.equal(response.status, 403);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "CSRF_REJECTED");
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    }
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W17 insight-decision proxy requires the session cookie", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body }), context);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W17 insight-decision proxy forwards the bearer, the body, and the API status and body without caching", async () => {
  const outcomes: Array<[number, unknown]> = [
    [200, { proposalId: "rule-a:v1:sub:field=x", decision: "retained", decidedAt: "2026-10-08T09:00:00.000Z", decidedBy: { id: "r1", displayName: "Responsable Test" } }],
    [404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }],
    [422, { error: { code: "VALIDATION_FAILED", message: "Cette décision d’insight est invalide." } }],
  ];
  for (const [status, payload] of outcomes) {
    const calls: Array<{ url: string; authorization: string | null; contentType: string | null; cache?: RequestCache; method?: string; body?: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), authorization: headers.get("authorization"), contentType: headers.get("content-type"), cache: init?.cache, method: init?.method, body: init?.body });
      return Response.json(payload, { status });
    };
    try {
      const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}`, "content-type": "application/json" }, body }), context);
      assert.equal(response.status, status);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.deepEqual(await response.json(), payload);
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, new RegExp(`/api/v1/tasks/${taskId}/insight-decisions$`));
      assert.equal(calls[0]!.authorization, `Bearer ${token}`);
      assert.equal(calls[0]!.contentType, "application/json");
      assert.equal(calls[0]!.cache, "no-store");
      assert.equal(calls[0]!.method, "POST");
      assert.equal(calls[0]!.body, body);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("W17 insight-decision proxy returns 503 when the API is unreachable", async () => {
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  try {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body }), context);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "SERVICE_UNAVAILABLE");
  } finally { globalThis.fetch = originalFetch; }
});
