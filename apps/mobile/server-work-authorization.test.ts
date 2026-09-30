import assert from "node:assert/strict";
import test from "node:test";
import { runOnlyWhenOnlineAuthorized, ServerWorkAuthorizationError } from "./server-work-authorization.js";
import type { OfflineAuthorizationState } from "./offline-authorization-state.js";

const lockedStatuses: OfflineAuthorizationState["status"][] = [
  "locked-expired",
  "locked-logged-out",
  "locked-deactivated",
  "locked-corrupt-or-clock-invalid",
  "offline-authorized",
  "revalidating",
];

for (const status of lockedStatuses) {
  test(`server work is blocked when local authorization is ${status}`, async () => {
    let workCalls = 0;
    await assert.rejects(
      runOnlyWhenOnlineAuthorized(async () => ({ status }), async () => { workCalls++; return "worked"; }),
      (error: unknown) => error instanceof ServerWorkAuthorizationError && error.authorization.status === status,
    );
    assert.equal(workCalls, 0);
  });
}

test("server work runs only after current online authorization succeeds", async () => {
  let workCalls = 0;
  const result = await runOnlyWhenOnlineAuthorized(
    async () => ({ status: "online-authorized" }),
    async () => { workCalls++; return "worked"; },
  );
  assert.equal(result, "worked");
  assert.equal(workCalls, 1);
});
