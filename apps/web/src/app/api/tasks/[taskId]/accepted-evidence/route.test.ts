import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.js";

const originalFetch = globalThis.fetch;
const token = "opaque-session-token-value-not-for-the-browser";
const taskId = "00000000-0000-4000-8000-000000000050";
const context = { params: Promise.resolve({ taskId }) };
const url = `http://localhost/api/tasks/${taskId}/accepted-evidence`;

test("W1 accepted-evidence proxy requires the session cookie and forwards nothing without it", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const response = await GET(new Request(url), context);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W1 accepted-evidence proxy forwards only the bearer, passes the API status and body through, and never caches", async () => {
  const outcomes: Array<[number, unknown]> = [
    [200, { task: { id: taskId } }],
    [403, { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } }],
    [404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }],
    [500, { error: { code: "INTERNAL_ERROR", message: "Les preuves n’ont pas pu être chargées." } }],
  ];
  for (const [status, payload] of outcomes) {
    const calls: Array<{ url: string; headers: Headers; cache?: RequestCache; method?: string }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), cache: init?.cache, method: init?.method });
      return Response.json(payload, { status });
    };
    try {
      const response = await GET(new Request(url, { headers: { cookie: `other=1; cetem_qc_session=${token}` } }), context);
      assert.equal(response.status, status);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.deepEqual(await response.json(), payload);
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, new RegExp(`/api/v1/tasks/${taskId}/accepted-evidence$`));
      assert.equal(calls[0]!.headers.get("authorization"), `Bearer ${token}`);
      assert.equal(calls[0]!.headers.get("cookie"), null);
      assert.equal(calls[0]!.cache, "no-store");
      assert.ok(calls[0]!.method === undefined || calls[0]!.method === "GET");
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("W1 accepted-evidence proxy answers 503 SERVICE_UNAVAILABLE when the API is unreachable", async () => {
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  try {
    const response = await GET(new Request(url, { headers: { cookie: `cetem_qc_session=${token}` } }), context);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "SERVICE_UNAVAILABLE");
  } finally { globalThis.fetch = originalFetch; }
});
