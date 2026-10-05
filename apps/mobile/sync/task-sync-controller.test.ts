import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import type { ConflictResolution, LocalDraft, OutboxItem, OutboxTransition } from "../local-drafts/model.js";
import type { SyncRequest, SyncResult } from "./sync-engine.js";
import { createTaskSyncController, type SyncAuthorizationContext, type TaskSyncSnapshot, type TaskSyncStore } from "./task-sync-controller.js";

// Story 8.1 W1: the App's synchronization wiring (7.3 R15/R17 behaviours) tested without React.

function fakeStore() {
  const items = new Map<string, OutboxItem>();
  const snapshot = (item: OutboxItem): LocalDraft => ({
    id: `draft-${item.taskId}`, employeeId: item.employeeId, taskId: item.taskId, payloadSchemaVersion: 1, revision: 1, createdAt: 1, savedAt: 2,
    payload: { ...GRAPHIE_CALCULATION_IDENTITY, values: {} },
  });
  const store = {
    failList: false,
    resolutions: [] as ConflictResolution[],
    add(taskId: string, sequence: number, employeeId = "employee-a") {
      items.set(`op-${sequence}`, {
        operationId: `op-${sequence}`, idempotencyKey: `key-${sequence}`, employeeId, taskId, sequence, kind: "sync-draft", snapshotId: `snap-${sequence}`,
        baseRevision: 0, status: "queued", attemptCount: 0, lastError: null, outcome: null, outcomeMetadata: null, createdAt: sequence, updatedAt: sequence,
        resolvedAt: null, conflictOperationId: null, conflictResolutionId: null,
      });
    },
    async listOutbox(employeeId: string) {
      if (store.failList) throw new Error("storage locked");
      return [...items.values()].filter((item) => item.employeeId === employeeId).map((item) => ({ ...item }));
    },
    async listConflictResolutions(employeeId: string) { return store.resolutions.filter((item) => item.employeeId === employeeId); },
    async listCorrectionDrafts() { return []; },
    async readOutboxSnapshot(_employeeId: string, operationId: string) { return snapshot(items.get(operationId)!); },
    async recordOutboxTransition(_employeeId: string, operationId: string, transition: OutboxTransition) {
      const item = items.get(operationId)!;
      if (transition.type === "attempt-start") Object.assign(item, { status: "in-flight", attemptCount: item.attemptCount + 1 });
      else if (transition.type === "outcome") Object.assign(item, { status: "resolved", outcome: transition.outcome, resolvedAt: transition.at });
      else Object.assign(item, { status: transition.type === "blocking" ? "blocked" : transition.pause ? "retry-paused" : "queued", lastError: transition.code });
      return { ...item };
    },
  };
  return store;
}

function setup(context: Partial<SyncAuthorizationContext> = {}, grantValid = true) {
  const store = fakeStore();
  const sent: SyncRequest[] = [];
  let gate: Promise<void> | undefined;
  const transport = {
    async send(request: SyncRequest): Promise<SyncResult> {
      sent.push(request);
      if (gate) await gate;
      return { type: "accepted", serverRevision: 1 };
    },
  };
  const state: SyncAuthorizationContext = { online: true, status: "online-authorized", identityId: "employee-a", ...context };
  const controller = createTaskSyncController({
    store: store as unknown as TaskSyncStore, transport, context: () => state,
    storedGrantValid: async () => grantValid, isActiveIdentity: (employeeId) => employeeId === state.identityId,
    now: () => 1, sleep: async () => undefined,
  });
  const snapshots: TaskSyncSnapshot[] = [];
  controller.subscribe((next) => snapshots.push(next));
  return { store, sent, state, controller, snapshots, hold: () => { let release!: () => void; gate = new Promise((resolve) => { release = resolve; }); return () => { gate = undefined; release(); }; } };
}

test("W1 each trigger runs the engine for the employee and refreshes the durable rows", async () => {
  const f = setup();
  let sequence = 0;
  for (const reason of ["online-authorization", "reconnect", "foreground", "changed-save"] as const) {
    f.store.add(`task-${reason}`, ++sequence);
    assert.equal(await f.controller.trigger("employee-a", reason), true, reason);
    assert.equal(f.sent.at(-1)?.operationId, `op-${sequence}`, reason);
  }
  assert.equal(f.sent.length, 4);
  const last = f.controller.getSnapshot();
  assert.equal(last.runningFor, undefined);
  assert.deepEqual(last.outbox?.items.map((item) => item.outcome), ["accepted", "accepted", "accepted", "accepted"]);
  assert.ok(f.snapshots.some((snapshot) => snapshot.runningFor === "employee-a"), "the run was shown as active");
});

test("W1 triggers during an active run give exactly one follow-up run", async () => {
  const f = setup();
  f.store.add("task-a", 1);
  const release = f.hold();
  const first = f.controller.trigger("employee-a", "online-authorization");
  await new Promise((resolve) => setTimeout(resolve, 0));
  f.store.add("task-b", 2);
  const second = f.controller.trigger("employee-a", "foreground");
  const third = f.controller.trigger("employee-a", "changed-save");
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await Promise.all([first, second, third]);
  assert.deepEqual(f.sent.map((request) => request.operationId), ["op-1", "op-2"]);
});

test("W1 no run offline, without online authorization, for another identity or with an invalid stored grant", async () => {
  for (const [context, grantValid, label] of [
    [{ online: false }, true, "offline"],
    [{ status: "offline-authorized" }, true, "offline-authorized only"],
    [{ status: "revalidating" }, true, "revalidating"],
    [{ identityId: "employee-b" }, true, "another identity"],
    [{}, false, "expired stored grant"],
  ] as const) {
    const f = setup(context, grantValid);
    f.store.add("task-a", 1);
    assert.equal(await f.controller.trigger("employee-a", "reconnect"), false, label);
    assert.equal(await f.controller.runSync("employee-a"), false, label);
    assert.deepEqual(f.sent, [], label);
  }
});

test("W1 a failed refresh keeps the previous rows and a refresh for another identity is ignored", async () => {
  const f = setup();
  f.store.add("task-a", 1);
  assert.equal(await f.controller.refreshOutbox("employee-a"), true);
  const before = f.controller.getSnapshot();
  f.store.failList = true;
  assert.equal(await f.controller.refreshOutbox("employee-a"), false);
  assert.equal(f.controller.getSnapshot(), before);
  f.store.failList = false;
  f.state.identityId = "employee-b";
  assert.equal(await f.controller.refreshOutbox("employee-a"), true);
  assert.equal(f.controller.getSnapshot(), before, "a signed-out identity's rows are not published");
  assert.equal(await f.controller.refreshOutbox(undefined), false);
});

test("W1 without a transport no run starts", async () => {
  const store = fakeStore();
  store.add("task-a", 1);
  const controller = createTaskSyncController({
    store: store as unknown as TaskSyncStore, transport: null,
    context: () => ({ online: true, status: "online-authorized", identityId: "employee-a" }),
    storedGrantValid: async () => true, isActiveIdentity: () => true,
  });
  assert.equal(controller.hasTransport(), false);
  assert.equal(await controller.trigger("employee-a", "online-authorization"), false);
});
