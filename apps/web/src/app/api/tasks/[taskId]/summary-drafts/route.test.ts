import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.js";

const originalFetch = globalThis.fetch;
const token = "opaque-session-token-value-not-for-the-browser";
const taskId = "00000000-0000-4000-8000-000000000041";
const context = { params: Promise.resolve({ taskId }) };
const url = `http://localhost/api/tasks/${taskId}/summary-drafts`;

test("W29 summary-draft proxy rejects cross-origin or origin-less requests without forwarding", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const rejected: Array<Record<string, string>> = [{ cookie: `cetem_qc_session=${token}` }, { cookie: `cetem_qc_session=${token}`, origin: "https://evil.example.test" }];
    for (const headers of rejected) {
      const response = await POST(new Request(url, { method: "POST", headers, body: "{}" }), context);
      assert.equal(response.status, 403);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "CSRF_REJECTED");
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    }
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W29 summary-draft proxy requires the session cookie", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body: "{}" }), context);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W29 summary-draft proxy forwards the bearer and an empty body, and passes the API status and body through without caching", async () => {
  const outcomes: Array<[number, unknown]> = [
    [201, { id: "00000000-0000-4000-8000-000000000042", status: "generated", text: "Brouillon.", provider: "mock", model: "mock-fixed-text", requestedAt: "2026-10-08T09:00:00.000Z", requestedBy: { id: "r1", displayName: "Responsable Test" }, summaryInputSetId: "a".repeat(64) }],
    [404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }],
    [502, { error: { code: "AI_UNAVAILABLE", message: "Le brouillon IA n’est pas disponible." } }],
  ];
  for (const [status, payload] of outcomes) {
    const calls: Array<{ url: string; authorization: string | null; cache?: RequestCache; method?: string; body?: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), cache: init?.cache, method: init?.method, body: init?.body });
      return Response.json(payload, { status });
    };
    try {
      // Whatever the browser sends, the API receives an empty object.
      const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}`, "content-type": "application/json" }, body: JSON.stringify({ text: "injected" }) }), context);
      assert.equal(response.status, status);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.deepEqual(await response.json(), payload);
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, new RegExp(`/api/v1/tasks/${taskId}/summary-drafts$`));
      assert.equal(calls[0]!.authorization, `Bearer ${token}`);
      assert.equal(calls[0]!.cache, "no-store");
      assert.equal(calls[0]!.method, "POST");
      assert.equal(calls[0]!.body, "{}");
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("W29 summary-draft proxy returns 503 when the API is unreachable", async () => {
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  try {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body: "{}" }), context);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "SERVICE_UNAVAILABLE");
  } finally { globalThis.fetch = originalFetch; }
});
