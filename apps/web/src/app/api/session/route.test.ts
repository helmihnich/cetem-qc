import assert from "node:assert/strict";
import { test } from "node:test";
import { DELETE, GET, POST } from "./route.js";
import { GET as getEmployees } from "../employees/route.js";
import { PATCH as updateEmployeeStatus } from "../employees/[employeeId]/status/route.js";
import { POST as createEmployee } from "../employees/create/route.js";
import { POST as createTask } from "../tasks/route.js";
import { GET as getTaskAssignees } from "../task-assignees/route.js";
import { POST as regenerateCredential } from "../employees/[employeeId]/credential/route.js";
import { POST as replacePassword } from "./password/route.js";

const originalFetch = globalThis.fetch;
const validToken = "opaque-session-token-value-not-for-the-browser";
const session = { user: { id: "owner-id", email: "owner@example.com", displayName: "Owner", role: "responsable", mustChangePassword: false }, sessionExpiresAt: "2026-09-28T00:00:00.000Z" };
const sameOriginHeaders = { origin: "http://localhost" };

function cookie(response: Response) {
  return response.headers.get("set-cookie") ?? "";
}

test("successful sign-in stores only an HttpOnly session cookie and never returns its token", async () => {
  globalThis.fetch = async () => Response.json({ token: validToken, user: session.user, sessionExpiresAt: session.sessionExpiresAt });
  try {
    const response = await POST(new Request("http://localhost/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "secret-password" }) }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: true });
    assert.match(cookie(response), /HttpOnly/);
    assert.match(cookie(response), /SameSite=Lax/i);
    assert.equal(cookie(response).includes(validToken), true);
    assert.equal(cookie(response).includes("secret-password"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("invalid credentials return safe French copy without setting a cookie", async () => {
  globalThis.fetch = async () => Response.json({ error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." } }, { status: 401 });
  try {
    const response = await POST(new Request("http://localhost/api/session", { method: "POST", body: JSON.stringify({ email: "x@example.com", password: "wrong" }) }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." } });
    assert.equal(cookie(response), "");
  } finally { globalThis.fetch = originalFetch; }
});

test("session restoration checks the API and clears expired or revoked cookies", async () => {
  let forwarded = "";
  globalThis.fetch = async (_input, init) => {
    forwarded = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." } }, { status: 401 });
  };
  try {
    const response = await GET(new Request("http://localhost/api/session", { headers: { cookie: `cetem_qc_session=${validToken}` } }));
    assert.equal(forwarded, `Bearer ${validToken}`);
    assert.equal(response.status, 401);
    assert.match(cookie(response), /Max-Age=0/);
  } finally { globalThis.fetch = originalFetch; }
});

test("server-validated Responsable session makes roster reachable; employee role remains denied", async () => {
  globalThis.fetch = async (input) => String(input).endsWith("/session")
    ? Response.json(session)
    : Response.json({ employees: [{ firstName: "Amel", surname: "Ben Ali", email: "amel@example.com", active: true }] });
  try {
    const restored = await GET(new Request("http://localhost/api/session", { headers: { cookie: `cetem_qc_session=${validToken}` } }));
    assert.equal((await restored.json() as typeof session).user.role, "responsable");
    const response = await getEmployees(new Request("http://localhost/api/employees", { headers: { cookie: `cetem_qc_session=${validToken}` } }));
    assert.deepEqual(await response.json(), { employees: [{ firstName: "Amel", surname: "Ben Ali", email: "amel@example.com", active: true }] });
    globalThis.fetch = async () => Response.json({ error: { code: "FORBIDDEN", message: "Accès réservé au responsable de l’équipe." } }, { status: 403 });
    const denied = await getEmployees(new Request("http://localhost/api/employees", { headers: { cookie: `cetem_qc_session=${validToken}` } }));
    assert.equal(denied.status, 403);
  } finally { globalThis.fetch = originalFetch; }
});

test("logout revokes the API session and clears browser cookie state", async () => {
  let method = "";
  globalThis.fetch = async (_input, init) => { method = init?.method ?? ""; return new Response(null, { status: 204 }); };
  try {
    const response = await DELETE(new Request("http://localhost/api/session", { method: "DELETE", headers: { ...sameOriginHeaders, cookie: `cetem_qc_session=${validToken}` } }));
    assert.equal(method, "DELETE");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false });
    assert.match(cookie(response), /Max-Age=0/);
  } finally { globalThis.fetch = originalFetch; }
});

test("employee status proxy requires the session cookie and forwards the protected mutation without team input", async () => {
  const anonymous = await updateEmployeeStatus(new Request("http://localhost/api/employees/id/status", { method: "PATCH", headers: sameOriginHeaders, body: JSON.stringify({ active: false }) }), { params: Promise.resolve({ employeeId: "target-id" }) });
  assert.equal(anonymous.status, 401);
  let forwardedUrl = "";
  let forwardedMethod = "";
  let forwardedBody = "";
  let forwardedAuthorization = "";
  globalThis.fetch = async (input, init) => {
    forwardedUrl = String(input); forwardedMethod = init?.method ?? ""; forwardedBody = String(init?.body ?? "");
    forwardedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ employee: { id: "target-id", firstName: "Amel", surname: "Ali", email: "amel@example.com", active: false } });
  };
  try {
    const response = await updateEmployeeStatus(new Request("http://localhost/api/employees/target-id/status", { method: "PATCH", headers: { ...sameOriginHeaders, cookie: `cetem_qc_session=${validToken}`, "content-type": "application/json" }, body: JSON.stringify({ active: false }) }), { params: Promise.resolve({ employeeId: "target-id" }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(forwardedUrl, /\/employees\/target-id\/status$/);
    assert.equal(forwardedMethod, "PATCH"); assert.equal(forwardedAuthorization, `Bearer ${validToken}`);
    assert.deepEqual(JSON.parse(forwardedBody), { active: false });
  } finally { globalThis.fetch = originalFetch; }
});

test("status mutation rejects missing, malformed and cross-origin Origin before forwarding", async () => {
  let forwarded = false;
  globalThis.fetch = async () => { forwarded = true; return Response.json({}); };
  try {
    for (const origin of [undefined, "not-an-origin", "null", "https://attacker.example"]) {
      const headers = new Headers({ cookie: `cetem_qc_session=${validToken}`, "content-type": "application/json" });
      if (origin !== undefined) headers.set("origin", origin);
      const response = await updateEmployeeStatus(new Request("http://localhost/api/employees/target-id/status", { method: "PATCH", headers, body: JSON.stringify({ active: false }) }), { params: Promise.resolve({ employeeId: "target-id" }) });
      assert.equal(response.status, 403);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "CSRF_REJECTED");
    }
    assert.equal(forwarded, false, "rejected requests must not forward the cookie token to the API");
  } finally { globalThis.fetch = originalFetch; }
});

test("cookie-authenticated employee, credential, password and logout mutations all reject cross-origin requests", async () => {
  let forwards = 0;
  globalThis.fetch = async () => { forwards++; return Response.json({ token: validToken, user: session.user, sessionExpiresAt: session.sessionExpiresAt }); };
  const crossOrigin = { origin: "https://attacker.example", cookie: `cetem_qc_session=${validToken}`, "content-type": "application/json" };
  try {
    const responses = await Promise.all([
      createEmployee(new Request("http://localhost/api/employees/create", { method: "POST", headers: crossOrigin, body: "{}" })),
      regenerateCredential(new Request("http://localhost/api/employees/id/credential", { method: "POST", headers: crossOrigin }), { params: Promise.resolve({ employeeId: "id" }) }),
      replacePassword(new Request("http://localhost/api/session/password", { method: "POST", headers: crossOrigin, body: "{}" })),
      DELETE(new Request("http://localhost/api/session", { method: "DELETE", headers: crossOrigin })),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [403, 403, 403, 403]);
    assert.equal(forwards, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("task assignee proxy uses the HttpOnly cookie without exposing it and task mutation checks same-origin before forwarding", async () => {
  let forwardedAuthorization = "";
  let forwardedBody = "";
  globalThis.fetch = async (_input, init) => {
    forwardedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    forwardedBody = String(init?.body ?? "");
    return init?.method === "POST" ? Response.json({ task: { id: "id", state: "draft" } }, { status: 201 }) : Response.json({ assignees: [] });
  };
  try {
    const assignees = await getTaskAssignees(new Request("http://localhost/api/task-assignees", { headers: { cookie: `cetem_qc_session=${validToken}` } }));
    assert.equal(assignees.status, 200);
    assert.equal(forwardedAuthorization, `Bearer ${validToken}`);
    assert.match(assignees.headers.get("cache-control") ?? "", /no-store/);

    forwardedAuthorization = "";
    const invalidOrigins = [undefined, "null", "not-an-origin", "https://attacker.example"];
    for (const origin of invalidOrigins) {
      const headers = new Headers({ cookie: `cetem_qc_session=${validToken}`, "content-type": "application/json" });
      if (origin !== undefined) headers.set("origin", origin);
      const rejected = await createTask(new Request("http://localhost/api/tasks", { method: "POST", headers, body: "{}" }));
      assert.equal(rejected.status, 403);
    }
    assert.equal(forwardedAuthorization, "", "invalid origins must be rejected before token forwarding");
    const created = await createTask(new Request("http://localhost/api/tasks", { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${validToken}`, "content-type": "application/json" }, body: JSON.stringify({ establishment: "Centre", service: "", type: "graphie_mobile", assigneeId: "00000000-0000-4000-8000-000000000001" }) }));
    assert.equal(created.status, 201);
    assert.equal(forwardedAuthorization, `Bearer ${validToken}`);
    assert.deepEqual(JSON.parse(forwardedBody), { establishment: "Centre", service: "", type: "graphie_mobile", assigneeId: "00000000-0000-4000-8000-000000000001" });
  } finally { globalThis.fetch = originalFetch; }
});
