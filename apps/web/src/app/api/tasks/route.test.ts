import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./route.js";

const originalFetch = globalThis.fetch;
const token = "opaque-session-token";

test("task-list proxy requires the HttpOnly session cookie and forwards only through the API scope", async () => {
  let forwardedUrl = "";
  let forwardedAuthorization = "";
  let forwardedCache: RequestCache | undefined;
  globalThis.fetch = async (input, init) => {
    forwardedUrl = String(input);
    forwardedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    forwardedCache = init?.cache;
    return Response.json({ tasks: [] });
  };
  try {
    const anonymous = await GET(new Request("http://localhost/api/tasks"));
    assert.equal(anonymous.status, 401);
    assert.equal(forwardedUrl, "");

    const response = await GET(new Request("http://localhost/api/tasks", { headers: { cookie: `cetem_qc_session=${token}` } }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.match(forwardedUrl, /\/api\/v1\/tasks$/);
    assert.equal(forwardedAuthorization, `Bearer ${token}`);
    assert.equal(forwardedCache, "no-store");
    assert.deepEqual(await response.json(), { tasks: [] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("task-list proxy forwards unsupported team queries for API rejection without task data", async () => {
  let forwardedUrl = "";
  globalThis.fetch = async (input) => {
    forwardedUrl = String(input);
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid query." } }, { status: 400 });
  };
  try {
    const response = await GET(new Request("http://localhost/api/tasks?teamId=other-team", { headers: { cookie: `cetem_qc_session=${token}` } }));
    assert.equal(response.status, 400);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.match(forwardedUrl, /\/api\/v1\/tasks\?teamId=other-team$/);
    assert.deepEqual(await response.json(), { error: { code: "VALIDATION_ERROR", message: "Invalid query." } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
