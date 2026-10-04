import assert from "node:assert/strict";
import test from "node:test";
import { createAppSyncTransport } from "./app-sync-transport.js";

test("R7 the 7.2 App transport is absent, so no synchronization run can start", () => {
  assert.equal(createAppSyncTransport(), null);
});
