import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import { createDraftRepository, type DraftRepository, type GraphieDraftPayload } from "../local-drafts/model.js";
import { createSqliteTestDouble, type SqliteTestDouble } from "../test-support/sqlite-test-double.js";
import { createSyncEngine, type SyncRequest, type SyncResult, type SyncStore } from "./sync-engine.js";

mock.module("expo-sqlite", { namedExports: { openDatabaseAsync: async () => { throw new Error("unused default driver"); } } });
mock.module("expo-crypto", { namedExports: { getRandomBytesAsync: async (length: number) => new Uint8Array(length) } });

type Response = SyncResult | "throw" | "record-then-throw";

function fakeTransport(responses: Response[] = [], fallback: Response = { type: "retryable", code: "HTTP_503" }) {
  const sent: SyncRequest[] = [];
  return {
    sent,
    async send(request: SyncRequest): Promise<SyncResult> {
      const response = responses.shift() ?? fallback;
      if (response === "throw") throw new Error("network down");
      sent.push(structuredClone(request));
      if (response === "record-then-throw") throw new Error("response lost");
      return response;
    },
  };
}

async function setup(double: SqliteTestDouble = createSqliteTestDouble(), secrets = new Map<string, string>()) {
  const { createSqliteDraftDatabase } = await import("../local-drafts/sqlite-draft-database.js");
  const store = {
    async get(key: string) { return secrets.get(key) ?? null; },
    async set(key: string, value: string) { secrets.set(key, value); },
    async remove(key: string) { secrets.delete(key); },
  };
  const database = createSqliteDraftDatabase(store, double.driver as never, async (length) => new Uint8Array(length).fill(0xcd));
  let time = 10_000;
  let id = Number(secrets.get("test-id-counter") ?? 0);
  const repository = createDraftRepository(database, () => ++time, () => {
    secrets.set("test-id-counter", String(++id));
    return `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
  });
  const waits: number[] = [];
  const engine = (transport: ReturnType<typeof fakeTransport>, options: { store?: SyncStore; isAuthorized?: (employeeId: string) => boolean } = {}) => createSyncEngine({
    store: options.store ?? repository, transport, now: () => ++time,
    sleep: async (ms) => { waits.push(ms); }, isAuthorized: options.isAuthorized ?? (() => true),
  });
  const dump = (table: string) => double.engine.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  return { double, secrets, repository, engine, waits, dump, restart: () => setup(double, secrets) };
}

const form = (reportNumber: string): GraphieDraftPayload => ({
  catalogueId: GRAPHIE_CALCULATION_IDENTITY.catalogueId,
  catalogueVersion: GRAPHIE_CALCULATION_IDENTITY.catalogueVersion,
  schemaVersion: GRAPHIE_CALCULATION_IDENTITY.schemaVersion,
  ruleId: GRAPHIE_CALCULATION_IDENTITY.ruleId,
  ruleVersion: GRAPHIE_CALCULATION_IDENTITY.ruleVersion,
  values: { "header.reportNumber": reportNumber },
});

/** Two unresolved items for one task: the first is marked attempted so the second save does not supersede it. */
async function twoItems(repository: DraftRepository, employeeId = "employee-a", taskId = "task-a") {
  const first = await repository.save(employeeId, taskId, form("1"));
  const [item1] = (await repository.listOutbox(employeeId)).filter((item) => item.taskId === taskId);
  await repository.recordOutboxTransition(employeeId, item1!.operationId, { type: "attempt-start", at: 1 });
  await repository.recordOutboxTransition(employeeId, item1!.operationId, { type: "retryable", code: "HTTP_503", pause: true, at: 2 });
  await repository.save(employeeId, taskId, form("2"), first.revision);
  const [, item2] = (await repository.listOutbox(employeeId)).filter((item) => item.taskId === taskId);
  return { item1: item1!, item2: item2! };
}

test("E1 an accepted item is resolved and sets the task's server revision", async () => {
  const f = await setup();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  const transport = fakeTransport([{ type: "accepted", serverRevision: 3 }]);
  const summary = await f.engine(transport).run("employee-a");
  assert.deepEqual(summary, { attempts: 1, resolved: 1, paused: 0, blocked: false });
  assert.deepEqual(transport.sent[0]!.snapshot, saved);
  assert.equal(transport.sent[0]!.baseRevision, 0);
  const [item] = await f.repository.listOutbox("employee-a");
  assert.equal(item!.status, "resolved");
  assert.equal(item!.outcome, "accepted");
  assert.equal(item!.outcomeMetadata?.serverRevision, 3);
  assert.ok(item!.resolvedAt);
  assert.deepEqual(f.dump("task_sync_state").map((row) => ({ ...(row as object) })), [{ employee_id: "employee-a", task_id: "task-a", server_revision: 3, updated_at: item!.resolvedAt }]);
  assert.deepEqual(await f.repository.getTaskSyncStatus("employee-a", "task-a"), { hasPendingSubmission: false, unresolvedCount: 0, lastOutcome: "accepted" });
});

test("E2 rejected and conflict outcomes are stored with their metadata and leave the draft untouched", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("rejected"));
  await f.repository.save("employee-a", "task-b", form("conflict"));
  const drafts = f.dump("local_drafts");
  const transport = fakeTransport([
    { type: "rejected", detail: { code: "SUBMISSION_INVALID", fields: ["header.reportNumber"] } },
    { type: "conflict", serverRevision: 7, detail: { code: "REVISION_CONFLICT" } },
  ]);
  await f.engine(transport).run("employee-a");
  const items = await f.repository.listOutbox("employee-a");
  assert.deepEqual(items.map((item) => [item.taskId, item.status, item.outcome, item.outcomeMetadata]), [
    ["task-a", "resolved", "rejected", { detail: { code: "SUBMISSION_INVALID", fields: ["header.reportNumber"] } }],
    ["task-b", "resolved", "conflict", { serverRevision: 7, detail: { code: "REVISION_CONFLICT" } }],
  ]);
  assert.deepEqual(f.dump("local_drafts"), drafts);
  assert.deepEqual(f.dump("task_sync_state"), [], "only an accepted outcome moves the known server revision");
});

test("E3 a lost response is retried with the same operation ID and idempotency key and stores one outcome", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  const transport = fakeTransport(["record-then-throw", { type: "accepted", serverRevision: 1 }]);
  await f.engine(transport).run("employee-a");
  assert.equal(transport.sent.length, 2);
  assert.equal(transport.sent[0]!.operationId, transport.sent[1]!.operationId);
  assert.equal(transport.sent[0]!.idempotencyKey, transport.sent[1]!.idempotencyKey);
  const items = await f.repository.listOutbox("employee-a");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.outcome, "accepted");
  assert.equal(items[0]!.attemptCount, 2);
});

test("E4 retryable results stop after 5 attempts with 1/2/4/8 s waits and pause the task", async () => {
  const f = await setup();
  const { item1, item2 } = await twoItems(f.repository);
  const transport = fakeTransport([], { type: "retryable", code: "HTTP_503" });
  const summary = await f.engine(transport).run("employee-a");
  assert.equal(transport.sent.length, 5);
  assert.ok(transport.sent.every((request) => request.operationId === item1.operationId), "later items of the task are not sent");
  assert.deepEqual(f.waits, [1000, 2000, 4000, 8000]);
  assert.deepEqual(summary, { attempts: 5, resolved: 0, paused: 1, blocked: false });
  const [paused, waiting] = await f.repository.listOutbox("employee-a");
  assert.equal(paused!.status, "retry-paused");
  assert.equal(paused!.lastError, "HTTP_503");
  assert.equal(waiting!.operationId, item2.operationId);
  assert.equal(waiting!.status, "queued");
  assert.equal(waiting!.attemptCount, 0);
});

test("E5 a new run after retry-paused sends again with the same key and keeps counting attempts", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  const transport = fakeTransport([], { type: "retryable", code: "TIMEOUT" });
  await f.engine(transport).run("employee-a");
  const [paused] = await f.repository.listOutbox("employee-a");
  assert.equal(paused!.attemptCount, 5);
  const next = fakeTransport([{ type: "retryable", code: "TIMEOUT" }, { type: "accepted", serverRevision: 2 }]);
  await f.engine(next).run("employee-a");
  assert.deepEqual(next.sent.map((request) => request.idempotencyKey), [paused!.idempotencyKey, paused!.idempotencyKey]);
  const [resolved] = await f.repository.listOutbox("employee-a");
  assert.equal(resolved!.attemptCount, 7);
  assert.equal(resolved!.outcome, "accepted");
});

test("E6 a blocking result (403 ACCOUNT_DEACTIVATED) blocks the item, stops the run and deletes nothing", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  await f.repository.save("employee-a", "task-b", form("2"));
  const before = { drafts: f.dump("local_drafts"), snapshots: f.dump("audit_snapshots") };
  const transport = fakeTransport([{ type: "blocking", code: "ACCOUNT_DEACTIVATED" }]);
  const summary = await f.engine(transport).run("employee-a");
  assert.equal(summary.blocked, true);
  assert.equal(transport.sent.length, 1, "the run stops at the authorization problem");
  const items = await f.repository.listOutbox("employee-a");
  assert.deepEqual(items.map((item) => [item.status, item.lastError]), [["blocked", "ACCOUNT_DEACTIVATED"], ["queued", null]]);
  assert.deepEqual({ drafts: f.dump("local_drafts"), snapshots: f.dump("audit_snapshots") }, before);
  const retry = fakeTransport([{ type: "accepted", serverRevision: 1 }, { type: "accepted", serverRevision: 1 }]);
  await f.engine(retry).run("employee-a");
  assert.equal(retry.sent[0]!.operationId, items[0]!.operationId, "a later run retries the blocked item");
});

test("E7 a transport that throws counts as retryable", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  const transport = fakeTransport(["throw", { type: "accepted", serverRevision: 1 }]);
  const summary = await f.engine(transport).run("employee-a");
  assert.deepEqual(f.waits, [1000]);
  assert.equal(summary.resolved, 1);
  const [item] = await f.repository.listOutbox("employee-a");
  assert.equal(item!.lastError, "transport-error");
  assert.equal(item!.attemptCount, 2);
});

test("unknown transport responses are never treated as definitive", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  const transport = fakeTransport([{ type: "accepted" } as unknown as SyncResult]);
  const summary = await f.engine(transport).run("employee-a");
  assert.equal(summary.blocked, true);
  const [item] = await f.repository.listOutbox("employee-a");
  assert.deepEqual([item!.status, item!.outcome, item!.lastError], ["blocked", null, "unexpected-response"]);
});

test("E8 items of a task are sent in order and the next item moves to the accepted revision", async () => {
  const f = await setup();
  const { item1, item2 } = await twoItems(f.repository);
  assert.equal(item1.baseRevision, item2.baseRevision);
  const transport = fakeTransport([{ type: "accepted", serverRevision: 4 }, { type: "accepted", serverRevision: 5 }]);
  await f.engine(transport).run("employee-a");
  assert.deepEqual(transport.sent.map((request) => [request.operationId, request.baseRevision]), [[item1.operationId, 0], [item2.operationId, 4]]);
  assert.equal((f.dump("task_sync_state")[0] as { server_revision: number }).server_revision, 5);
});

test("E9 when recording the outcome fails the item stays unresolved and the next run sends it again", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  let failOutcome = true;
  const flakyStore: SyncStore = {
    listOutbox: (employeeId) => f.repository.listOutbox(employeeId),
    readOutboxSnapshot: (employeeId, operationId) => f.repository.readOutboxSnapshot(employeeId, operationId),
    async recordOutboxTransition(employeeId, operationId, transition) {
      if (transition.type === "outcome" && failOutcome) { failOutcome = false; throw new Error("disk full"); }
      return f.repository.recordOutboxTransition(employeeId, operationId, transition);
    },
  };
  const transport = fakeTransport([{ type: "accepted", serverRevision: 1 }, { type: "accepted", serverRevision: 1 }]);
  await assert.rejects(f.engine(transport, { store: flakyStore }).run("employee-a"), /disk full/);
  const [unresolved] = await f.repository.listOutbox("employee-a");
  assert.equal(unresolved!.status, "in-flight");
  assert.equal(unresolved!.outcome, null);
  await f.engine(transport, { store: flakyStore }).run("employee-a");
  assert.equal(transport.sent.length, 2);
  assert.equal(transport.sent[1]!.idempotencyKey, transport.sent[0]!.idempotencyKey);
  assert.equal((await f.repository.listOutbox("employee-a"))[0]!.outcome, "accepted");
});

test("E10 nothing is sent when the employee is not authorized", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  const transport = fakeTransport([{ type: "accepted", serverRevision: 1 }]);
  const summary = await f.engine(transport, { isAuthorized: () => false }).run("employee-a");
  assert.equal(transport.sent.length, 0);
  assert.equal(summary.attempts, 0);
  assert.equal((await f.repository.listOutbox("employee-a"))[0]!.status, "queued");
});

test("E11 two concurrent run calls share one run and send once", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  const transport = fakeTransport([{ type: "accepted", serverRevision: 1 }]);
  const engine = f.engine(transport);
  const [first, second] = await Promise.all([engine.run("employee-a"), engine.run("employee-a")]);
  assert.equal(transport.sent.length, 1);
  assert.deepEqual(first, second);
});

test("E12 an item left in-flight by a crash is sent again with the same key after restart", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  const [item] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", item!.operationId, { type: "attempt-start", at: 1 });
  const restarted = await f.restart();
  const transport = fakeTransport([{ type: "accepted", serverRevision: 1 }]);
  await restarted.engine(transport).run("employee-a");
  assert.equal(transport.sent[0]!.idempotencyKey, item!.idempotencyKey);
  const [resolved] = await restarted.repository.listOutbox("employee-a");
  assert.equal(resolved!.attemptCount, 2);
  assert.equal(resolved!.outcome, "accepted");
});

test("a run for one employee never loads or sends another employee's items", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("A"));
  await f.repository.save("employee-b", "task-a", form("B"));
  const transport = fakeTransport([{ type: "accepted", serverRevision: 1 }, { type: "accepted", serverRevision: 1 }]);
  await f.engine(transport).run("employee-a");
  assert.deepEqual(transport.sent.map((request) => [request.employeeId, request.snapshot.employeeId]), [["employee-a", "employee-a"]]);
  assert.equal((await f.repository.listOutbox("employee-b"))[0]!.status, "queued");
});

test("a run requested for another employee during an active run starts after it and sends that employee's items", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("A"));
  await f.repository.save("employee-b", "task-b", form("B"));
  const transport = fakeTransport([{ type: "accepted", serverRevision: 1 }, { type: "accepted", serverRevision: 1 }]);
  const engine = f.engine(transport);
  const [first, second] = await Promise.all([engine.run("employee-a"), engine.run("employee-b")]);
  assert.deepEqual(transport.sent.map((request) => request.employeeId), ["employee-a", "employee-b"]);
  assert.equal(first.resolved, 1);
  assert.equal(second.resolved, 1);
});

test("authorization is checked again before each attempt and a lock during the run stops it", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  await f.repository.save("employee-a", "task-b", form("2"));
  let authorized = true;
  const inner = fakeTransport([{ type: "accepted", serverRevision: 1 }, { type: "accepted", serverRevision: 1 }]);
  const transport = { ...inner, async send(request: SyncRequest) { authorized = false; return inner.send(request); } };
  const summary = await f.engine(transport, { isAuthorized: () => authorized }).run("employee-a");
  assert.equal(inner.sent.length, 1);
  assert.deepEqual(summary, { attempts: 1, resolved: 1, paused: 0, blocked: false });
  assert.deepEqual((await f.repository.listOutbox("employee-a")).map((item) => item.status), ["resolved", "queued"]);
});

test("an unreadable snapshot blocks only its own task and is kept untouched", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  await f.repository.save("employee-a", "task-b", form("2"));
  const [unreadable] = await f.repository.listOutbox("employee-a");
  const snapshots = f.dump("audit_snapshots");
  const store: SyncStore = {
    listOutbox: (employeeId) => f.repository.listOutbox(employeeId),
    async readOutboxSnapshot(employeeId, operationId) {
      if (operationId === unreadable!.operationId) throw new Error("Corrupt or unsupported local draft.");
      return f.repository.readOutboxSnapshot(employeeId, operationId);
    },
    recordOutboxTransition: (employeeId, operationId, transition) => f.repository.recordOutboxTransition(employeeId, operationId, transition),
  };
  const transport = fakeTransport([{ type: "accepted", serverRevision: 1 }]);
  const summary = await f.engine(transport, { store }).run("employee-a");
  assert.deepEqual(transport.sent.map((request) => request.taskId), ["task-b"]);
  assert.deepEqual(summary, { attempts: 1, resolved: 1, paused: 0, blocked: false });
  const items = await f.repository.listOutbox("employee-a");
  assert.deepEqual(items.map((item) => [item.taskId, item.status, item.lastError, item.attemptCount]), [
    ["task-a", "blocked", "snapshot-unreadable", 0],
    ["task-b", "resolved", null, 1],
  ]);
  assert.deepEqual(f.dump("audit_snapshots"), snapshots);
});

test("a missing snapshot row blocks its item instead of looping and the run still ends", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("1"));
  await f.repository.save("employee-a", "task-b", form("2"));
  const [orphan] = await f.repository.listOutbox("employee-a");
  // Simulates a damaged database: the app's own SQLite connection does not enforce the foreign key.
  f.double.engine.exec("PRAGMA foreign_keys = OFF");
  f.double.engine.prepare("DELETE FROM audit_snapshots WHERE snapshot_id = ?").run(orphan!.snapshotId);
  f.double.engine.exec("PRAGMA foreign_keys = ON");
  const transport = fakeTransport([{ type: "accepted", serverRevision: 1 }]);
  const summary = await f.engine(transport).run("employee-a");
  assert.deepEqual(transport.sent.map((request) => request.taskId), ["task-b"]);
  assert.equal(summary.blocked, false);
  assert.deepEqual((await f.repository.listOutbox("employee-a")).map((item) => [item.status, item.lastError]), [["blocked", "snapshot-unreadable"], ["resolved", null]]);
});

test("an item discarded by an explicit delete while it is being sent is skipped and the run continues", async () => {
  const f = await setup();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  await f.repository.save("employee-a", "task-b", form("2"));
  const inner = fakeTransport([{ type: "accepted", serverRevision: 1 }, { type: "accepted", serverRevision: 1 }]);
  const transport = {
    ...inner,
    async send(request: SyncRequest) {
      if (request.taskId === "task-a") await f.repository.delete("employee-a", "task-a", saved.revision);
      return inner.send(request);
    },
  };
  const summary = await f.engine(transport).run("employee-a");
  assert.deepEqual(inner.sent.map((request) => request.taskId), ["task-a", "task-b"]);
  assert.deepEqual(summary, { attempts: 2, resolved: 1, paused: 0, blocked: false });
  assert.deepEqual((await f.repository.listOutbox("employee-a")).map((item) => [item.taskId, item.outcome]), [["task-b", "accepted"]]);
});

test("the task sync status reports the most recent of several outcomes", async () => {
  const f = await setup();
  await twoItems(f.repository);
  const transport = fakeTransport([{ type: "accepted", serverRevision: 4 }, { type: "rejected", detail: { code: "SUBMISSION_INVALID" } }]);
  await f.engine(transport).run("employee-a");
  assert.deepEqual(await f.repository.getTaskSyncStatus("employee-a", "task-a"), { hasPendingSubmission: false, unresolvedCount: 0, lastOutcome: "rejected" });
});

test("P1 a restarted engine and repository see byte-identical unresolved items after a transport failure", async () => {
  const f = await setup();
  await twoItems(f.repository);
  await f.repository.requestSubmission("employee-a", "task-b", form("submitted"));
  await f.engine(fakeTransport([], { type: "retryable", code: "OFFLINE" })).run("employee-a");
  const before = { outbox: f.dump("outbox_operations"), snapshots: f.dump("audit_snapshots") };
  const restarted = await f.restart();
  assert.deepEqual({ outbox: restarted.dump("outbox_operations"), snapshots: restarted.dump("audit_snapshots") }, before);
  assert.equal((await restarted.repository.listOutbox("employee-a")).filter((item) => item.status !== "resolved").length, 3);
});
