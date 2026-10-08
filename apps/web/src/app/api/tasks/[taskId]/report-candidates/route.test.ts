import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "./route.js";
import { GET as GET_FILE } from "./[candidateId]/file/route.js";

const originalFetch = globalThis.fetch;
const token = "opaque-session-token-value-not-for-the-browser";
const taskId = "00000000-0000-4000-8000-000000000071";
const candidateId = "00000000-0000-4000-8000-000000000072";
const context = { params: Promise.resolve({ taskId }) };
const fileContext = { params: Promise.resolve({ taskId, candidateId }) };
const url = `http://localhost/api/tasks/${taskId}/report-candidates`;
const fileUrl = `${url}/${candidateId}/file`;
const body = JSON.stringify({ attemptId: "00000000-0000-4000-8000-000000000073" });
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("U8 report-candidates proxy rejects cross-origin or origin-less POSTs without forwarding", async () => {
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

test("U8 report-candidates proxy requires the session cookie on every handler", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const responses = [
      await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body }), context),
      await GET(new Request(url), context),
      await GET_FILE(new Request(fileUrl), fileContext),
    ];
    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    }
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("U8 report-candidates proxy forwards the bearer and passes status and body through without caching", async () => {
  const outcomes: Array<[number, unknown]> = [
    [201, { id: "c1" }], [404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }],
    [409, { error: { code: "SUMMARY_NOT_CONFIRMED", message: "x" } }], [409, { error: { code: "CONFORMITY_NOT_DECIDED", message: "x" } }],
    [502, { error: { code: "REPORT_GENERATION_FAILED", message: "x" } }], [422, { error: { code: "VALIDATION_FAILED", message: "x" } }],
  ];
  for (const [status, payload] of outcomes) {
    const calls: Array<{ url: string; authorization: string | null; cache?: RequestCache; method?: string; body?: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), cache: init?.cache, method: init?.method, body: init?.body });
      return Response.json(payload, { status });
    };
    try {
      const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}`, "content-type": "application/json" }, body }), context);
      assert.equal(response.status, status);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.deepEqual(await response.json(), payload);
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, new RegExp(`/api/v1/tasks/${taskId}/report-candidates$`));
      assert.equal(calls[0]!.authorization, `Bearer ${token}`);
      assert.equal(calls[0]!.cache, "no-store");
      assert.equal(calls[0]!.method, "POST");
      assert.equal(calls[0]!.body, body);
    } finally { globalThis.fetch = originalFetch; }
  }
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), new RegExp(`/api/v1/tasks/${taskId}/report-candidates$`));
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    return Response.json({ candidates: [] });
  };
  try {
    const response = await GET(new Request(url, { headers: { cookie: `cetem_qc_session=${token}` } }), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { candidates: [] });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  } finally { globalThis.fetch = originalFetch; }
});

test("U8 report-candidates proxy returns 503 when the API is unreachable", async () => {
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  try {
    const headers = { origin: "http://localhost", cookie: `cetem_qc_session=${token}` };
    for (const response of [await POST(new Request(url, { method: "POST", headers, body }), context), await GET(new Request(url, { headers }), context), await GET_FILE(new Request(fileUrl, { headers }), fileContext)]) {
      assert.equal(response.status, 503);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "SERVICE_UNAVAILABLE");
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("U8 the file handler forwards the bytes and the download headers, and passes a refusal through", async () => {
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), new RegExp(`/api/v1/tasks/${taskId}/report-candidates/${candidateId}/file$`));
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    return new Response(bytes, { status: 200, headers: { "content-type": DOCX, "content-disposition": 'attachment; filename="Rapport-LCQ-candidat-20261008-00000000.docx"' } });
  };
  try {
    const response = await GET_FILE(new Request(fileUrl, { headers: { cookie: `cetem_qc_session=${token}` } }), fileContext);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), DOCX);
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="Rapport-LCQ-candidat-/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  } finally { globalThis.fetch = originalFetch; }
  globalThis.fetch = async () => Response.json({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }, { status: 404 });
  try {
    const response = await GET_FILE(new Request(fileUrl, { headers: { cookie: `cetem_qc_session=${token}` } }), fileContext);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } });
  } finally { globalThis.fetch = originalFetch; }
});
