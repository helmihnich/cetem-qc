import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "./route.js";

const originalFetch = globalThis.fetch;
const token = "opaque-session-token-value-not-for-the-browser";
const employeeId = "00000000-0000-4000-8000-000000000020";
const context = { params: Promise.resolve({ employeeId }) };
const url = `http://localhost/api/employees/${employeeId}/password-reset`;

test("W1 password-reset proxy rejects cross-origin or origin-less requests without forwarding", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const rejected: Array<Record<string, string>> = [{ cookie: `cetem_qc_session=${token}` }, { cookie: `cetem_qc_session=${token}`, origin: "https://evil.example.test" }];
    for (const headers of rejected) {
      const response = await POST(new Request(url, { method: "POST", headers }), context);
      assert.equal(response.status, 403);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    }
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W1 password-reset proxy requires the session cookie", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" } }), context);
    assert.equal(response.status, 401);
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("W1 password-reset proxy forwards the bearer and the API status without caching", async () => {
  const calls: Array<{ url: string; authorization: string | null; cache?: RequestCache; method?: string }> = [];
  const conflict = { error: { code: "EMPLOYEE_INACTIVE", message: "Ce Technicien est désactivé. Réactivez-le avant de réinitialiser son mot de passe." } };
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), cache: init?.cache, method: init?.method });
    return Response.json(conflict, { status: 409 });
  };
  try {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` } }), context);
    assert.equal(response.status, 409);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.deepEqual(await response.json(), conflict);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, new RegExp(`/api/v1/employees/${employeeId}/password-reset$`));
    assert.equal(calls[0]!.authorization, `Bearer ${token}`);
    assert.equal(calls[0]!.cache, "no-store");
    assert.equal(calls[0]!.method, "POST");
  } finally { globalThis.fetch = originalFetch; }
});

test("W1 password-reset proxy returns 503 when the API is unreachable", async () => {
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  try {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` } }), context);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "SERVICE_UNAVAILABLE");
  } finally { globalThis.fetch = originalFetch; }
});
