import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.js";

const originalFetch = globalThis.fetch;
const token = "opaque-session-token";
const context = { params: Promise.resolve({ taskId: "task-1" }) };

test("recovery proxy enforces CSRF/session and forwards response without caching", async () => {
  let forwarded = "";
  let authorization = "";
  globalThis.fetch = async (input, init) => {
    forwarded = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    assert.equal(init?.cache, "no-store");
    return Response.json({ task: { id: "task-2" }, recoveryId: "recovery-1" }, { status: 201 });
  };
  try {
    const csrf = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-recovery", {
      method: "POST", headers: { origin: "http://evil.example", cookie: `cetem_qc_session=${token}` }, body: "{}",
    }), context);
    assert.equal(csrf.status, 403);
    const anonymous = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-recovery", { method: "POST", headers: { origin: "http://localhost" }, body: "{}" }), context);
    assert.equal(anonymous.status, 401);
    const response = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-recovery", {
      method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body: "{}",
    }), context);
    assert.equal(response.status, 201);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.match(forwarded, /deactivated-assignee-recovery$/);
    assert.equal(authorization, `Bearer ${token}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recovery proxy forwards API errors and returns unavailable on connection failure", async () => {
  globalThis.fetch = async () => Response.json({ error: { code: "TASK_RECOVERY_STATE_CHANGED", message: "Refresh." } }, { status: 409 });
  try {
    const response = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-recovery", {
      method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body: "{}",
    }), context);
    assert.equal(response.status, 409);
    globalThis.fetch = async () => { throw new Error("offline"); };
    const unavailable = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-recovery", {
      method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body: "{}",
    }), context);
    assert.equal(unavailable.status, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
