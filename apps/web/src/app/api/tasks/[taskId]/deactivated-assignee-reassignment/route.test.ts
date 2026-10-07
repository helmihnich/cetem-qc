import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.js";

const originalFetch = globalThis.fetch;
const token = "opaque-session-token";
const context = { params: Promise.resolve({ taskId: "task-1" }) };

test("reassignment proxy enforces CSRF/session and forwards only through the API with no-store", async () => {
  let forwarded = "";
  let authorization = "";
  let cache: RequestCache | undefined;
  globalThis.fetch = async (input, init) => {
    forwarded = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    cache = init?.cache;
    return Response.json({ taskId: "task-1", assigneeId: "employee-2", assignmentVersion: 2 });
  };
  try {
    const csrf = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-reassignment", {
      method: "POST", headers: { origin: "http://evil.example", cookie: `cetem_qc_session=${token}` }, body: "{}",
    }), context);
    assert.equal(csrf.status, 403);
    const anonymous = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-reassignment", { method: "POST", headers: { origin: "http://localhost" }, body: "{}" }), context);
    assert.equal(anonymous.status, 401);
    const response = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-reassignment", {
      method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}`, "content-type": "application/json" }, body: "{}",
    }), context);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.match(forwarded, /deactivated-assignee-reassignment$/);
    assert.equal(authorization, `Bearer ${token}`);
    assert.equal(cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reassignment proxy maps API failure and unavailable service", async () => {
  globalThis.fetch = async () => Response.json({ error: { code: "TASK_RECOVERY_STATE_CHANGED", message: "Refresh." } }, { status: 409 });
  try {
    const response = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-reassignment", {
      method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body: "{}",
    }), context);
    assert.equal(response.status, 409);
    globalThis.fetch = async () => { throw new Error("offline"); };
    const unavailable = await POST(new Request("http://localhost/api/tasks/task-1/deactivated-assignee-reassignment", {
      method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body: "{}",
    }), context);
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers.get("cache-control") ?? "", /no-store/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
