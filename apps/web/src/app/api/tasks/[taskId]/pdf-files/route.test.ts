import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "./route.js";
import { GET as GET_CONTENT } from "./[fileId]/content/route.js";
import { POST as POST_RETRY } from "./[fileId]/scan-retries/route.js";

// Story 11.2 (W6): the Next route handlers are thin proxies; the browser never sees the bearer.

const originalFetch = globalThis.fetch;
const token = "opaque-session-token-value-not-for-the-browser";
const taskId = "00000000-0000-4000-8000-000000000081";
const fileId = "00000000-0000-4000-8000-000000000082";
const attemptId = "00000000-0000-4000-8000-000000000083";
const context = { params: Promise.resolve({ taskId }) };
const fileContext = { params: Promise.resolve({ taskId, fileId }) };
const url = `http://localhost/api/tasks/${taskId}/pdf-files`;
const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 0, 255, 128]);

test("W6 pdf-files proxy rejects cross-origin or origin-less POSTs without forwarding", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const rejected: Array<Record<string, string>> = [{ cookie: `cetem_qc_session=${token}` }, { cookie: `cetem_qc_session=${token}`, origin: "https://evil.example.test" }];
    for (const headers of rejected) {
      for (const response of [
        await POST(new Request(url, { method: "POST", headers, body: pdf }), context),
        await POST_RETRY(new Request(`${url}/${fileId}/scan-retries`, { method: "POST", headers }), fileContext),
      ]) {
        assert.equal(response.status, 403);
        assert.equal((await response.json() as { error: { code: string } }).error.code, "CSRF_REJECTED");
        assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      }
    }
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W6 pdf-files proxy requires the session cookie on every handler", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const responses = [
      await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body: pdf }), context),
      await GET(new Request(url), context),
      await GET_CONTENT(new Request(`${url}/${fileId}/content`), fileContext),
      await POST_RETRY(new Request(`${url}/${fileId}/scan-retries`, { method: "POST", headers: { origin: "http://localhost" } }), fileContext),
    ];
    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    }
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W6 the upload forwards the raw bytes, media type, attempt ID, file name and the bearer; status and body pass through uncached", async () => {
  for (const [status, payload] of [[201, { id: fileId }], [413, { error: { code: "FILE_TOO_LARGE", message: "x" } }], [415, { error: { code: "UNSUPPORTED_FILE_TYPE", message: "x" } }],
    [404, { error: { code: "TASK_NOT_FOUND", message: "x" } }], [502, { error: { code: "FILE_STORAGE_FAILED", message: "x" } }]] as Array<[number, unknown]>) {
    const calls: Array<{ url: string; headers: Headers; body: Uint8Array; cache?: RequestCache; method?: string }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: new Uint8Array(init?.body as ArrayBuffer), cache: init?.cache, method: init?.method });
      return Response.json(payload, { status });
    };
    try {
      const response = await POST(new Request(url, {
        method: "POST", body: pdf,
        headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}`, "content-type": "application/pdf", "x-attempt-id": attemptId, "x-file-name": "Rapport%20sign%C3%A9.pdf" },
      }), context);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), payload);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, `http://127.0.0.1:3001/api/v1/tasks/${taskId}/pdf-files`);
      assert.equal(calls[0]!.method, "POST");
      assert.equal(calls[0]!.cache, "no-store");
      assert.equal(calls[0]!.headers.get("authorization"), `Bearer ${token}`);
      assert.deepEqual([calls[0]!.headers.get("content-type"), calls[0]!.headers.get("x-attempt-id"), calls[0]!.headers.get("x-file-name")], ["application/pdf", attemptId, "Rapport%20sign%C3%A9.pdf"]);
      assert.deepEqual([...calls[0]!.body], [...pdf]);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("W6 the content handler streams the PDF with the required headers; refusals pass through; 503 when the API is unreachable", async () => {
  globalThis.fetch = async () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Rapport-LCQ-manuel-20261008-00000000.pdf"' } });
  try {
    const response = await GET_CONTENT(new Request(`${url}/${fileId}/content`, { headers: { cookie: `cetem_qc_session=${token}` } }), fileContext);
    assert.equal(response.status, 200);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...pdf]);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="Rapport-LCQ-manuel-20261008-00000000.pdf"');
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    globalThis.fetch = async () => Response.json({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }, { status: 404 });
    const missing = await GET_CONTENT(new Request(`${url}/${fileId}/content`, { headers: { cookie: `cetem_qc_session=${token}` } }), fileContext);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as { error: { code: string } }).error.code, "TASK_NOT_FOUND");
    globalThis.fetch = async () => { throw new Error("down"); };
    const cookie = { headers: { cookie: `cetem_qc_session=${token}`, origin: "http://localhost" } };
    for (const unreachable of [
      await GET(new Request(url, cookie), context), await GET_CONTENT(new Request(`${url}/${fileId}/content`, cookie), fileContext),
      await POST(new Request(url, { method: "POST", body: pdf, ...cookie }), context), await POST_RETRY(new Request(`${url}/${fileId}/scan-retries`, { method: "POST", ...cookie }), fileContext),
    ]) {
      assert.equal(unreachable.status, 503);
      assert.match(unreachable.headers.get("cache-control") ?? "", /no-store/i);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("W6 list and rescan forward the bearer and pass the body through", async () => {
  const calls: Array<{ url: string; authorization: string | null; method?: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), method: init?.method });
    return Response.json({ files: [] }, { status: 200 });
  };
  try {
    const cookie = { cookie: `cetem_qc_session=${token}`, origin: "http://localhost" };
    assert.equal((await GET(new Request(url, { headers: cookie }), context)).status, 200);
    assert.equal((await POST_RETRY(new Request(`${url}/${fileId}/scan-retries`, { method: "POST", headers: cookie }), fileContext)).status, 200);
    assert.deepEqual(calls.map((call) => [call.url, call.authorization, call.method]), [
      [`http://127.0.0.1:3001/api/v1/tasks/${taskId}/pdf-files`, `Bearer ${token}`, undefined],
      [`http://127.0.0.1:3001/api/v1/tasks/${taskId}/pdf-files/${fileId}/scan-retries`, `Bearer ${token}`, "POST"],
    ]);
  } finally { globalThis.fetch = originalFetch; }
});
