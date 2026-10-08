import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.js";

// Story 11.3 (W6): the Next route handler is a thin proxy; the browser never sees the bearer.

const originalFetch = globalThis.fetch;
const token = "opaque-session-token-value-not-for-the-browser";
const taskId = "00000000-0000-4000-8000-000000000091";
const fileId = "00000000-0000-4000-8000-000000000092";
const attemptId = "00000000-0000-4000-8000-000000000093";
const context = { params: Promise.resolve({ taskId, fileId }) };
const url = `http://localhost/api/tasks/${taskId}/pdf-files/${fileId}/report-candidate`;
const body = JSON.stringify({ attemptId });

test("W6 report-candidate proxy rejects cross-origin or origin-less POSTs and requires the session cookie, without forwarding", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const rejected: Array<Record<string, string>> = [{ cookie: `cetem_qc_session=${token}` }, { cookie: `cetem_qc_session=${token}`, origin: "https://evil.example.test" }];
    for (const headers of rejected) {
      const response = await POST(new Request(url, { method: "POST", headers, body }), context);
      assert.equal(response.status, 403);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "CSRF_REJECTED");
    }
    const anonymous = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body }), context);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W6 the request is forwarded with the bearer; status and body pass through uncached; 503 when the API is unreachable", async () => {
  for (const [status, payload] of [[201, { id: fileId }], [200, { id: fileId }], [404, { error: { code: "TASK_NOT_FOUND", message: "x" } }], [409, { error: { code: "REPORT_FILE_NOT_READY", message: "x" } }],
    [422, { error: { code: "VALIDATION_FAILED", message: "x" } }]] as Array<[number, unknown]>) {
    const calls: Array<{ url: string; headers: Headers; body: unknown; cache?: RequestCache; method?: string }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: init?.body, cache: init?.cache, method: init?.method });
      return Response.json(payload, { status });
    };
    try {
      const response = await POST(new Request(url, { method: "POST", body, headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}`, "content-type": "application/json" } }), context);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), payload);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, `http://127.0.0.1:3001/api/v1/tasks/${taskId}/pdf-files/${fileId}/report-candidate`);
      assert.deepEqual([calls[0]!.method, calls[0]!.cache, calls[0]!.headers.get("authorization"), calls[0]!.body], ["POST", "no-store", `Bearer ${token}`, body]);
    } finally { globalThis.fetch = originalFetch; }
  }
  globalThis.fetch = async () => { throw new Error("down"); };
  try {
    const unreachable = await POST(new Request(url, { method: "POST", body, headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` } }), context);
    assert.equal(unreachable.status, 503);
    assert.match(unreachable.headers.get("cache-control") ?? "", /no-store/i);
  } finally { globalThis.fetch = originalFetch; }
});
