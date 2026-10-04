import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import { createAuthorizedDrafts } from "./authorized-drafts.js";
import { createDraftRepository, OutboxOperationNotFoundError, PendingSubmissionError, SubmissionNotAllowedError, type GraphieDraftPayload } from "./model.js";
import { createOfflineAuthorizationService } from "../offline-authorization-state.js";
import { createSqliteTestDouble, type SqliteTestDouble } from "../test-support/sqlite-test-double.js";

mock.module("expo-sqlite", { namedExports: { openDatabaseAsync: async () => { throw new Error("unused default driver"); } } });
mock.module("expo-crypto", { namedExports: { getRandomBytesAsync: async (length: number) => new Uint8Array(length) } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;

/** Opens the adapter over a (possibly shared) SQLite engine; calling it again over the same double simulates a restart. */
async function open(double: SqliteTestDouble = createSqliteTestDouble(), secrets = new Map<string, string>()) {
  const { createSqliteDraftDatabase } = await import("./sqlite-draft-database.js");
  const store = {
    async get(key: string) { return secrets.get(key) ?? null; },
    async set(key: string, value: string) { secrets.set(key, value); },
    async remove(key: string) { secrets.delete(key); },
  };
  const database = createSqliteDraftDatabase(store, double.driver as never, async (length) => new Uint8Array(length).fill(0xab));
  let time = 1_000;
  let id = 0;
  const createId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
  const repository = createDraftRepository(database, () => ++time, createId);
  const dump = (table: string) => double.engine.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const dumpAll = () => ({ drafts: dump("local_drafts"), snapshots: dump("audit_snapshots"), outbox: dump("outbox_operations"), state: dump("task_sync_state") });
  return { double, secrets, database, repository, dump, dumpAll, restart: () => open(double, secrets) };
}

const form = (reportNumber: string, extra: Partial<GraphieDraftPayload> = {}): GraphieDraftPayload => ({
  catalogueId: GRAPHIE_CALCULATION_IDENTITY.catalogueId,
  catalogueVersion: GRAPHIE_CALCULATION_IDENTITY.catalogueVersion,
  schemaVersion: GRAPHIE_CALCULATION_IDENTITY.schemaVersion,
  ruleId: GRAPHIE_CALCULATION_IDENTITY.ruleId,
  ruleVersion: GRAPHIE_CALCULATION_IDENTITY.ruleVersion,
  values: { "header.reportNumber": reportNumber },
  ...extra,
});

const V2_SCHEMA = `
  CREATE TABLE local_drafts (
    employee_id TEXT NOT NULL, task_id TEXT NOT NULL, draft_id TEXT NOT NULL UNIQUE, payload_schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0), created_at INTEGER NOT NULL, saved_at INTEGER NOT NULL, payload_json TEXT NOT NULL,
    PRIMARY KEY (employee_id, task_id));
  CREATE INDEX local_drafts_employee_saved ON local_drafts(employee_id, saved_at DESC);
  CREATE TABLE synchronized_tasks (employee_id TEXT NOT NULL, task_id TEXT NOT NULL, task_json TEXT NOT NULL, synchronized_at INTEGER NOT NULL,
    PRIMARY KEY (employee_id, task_id));
  PRAGMA user_version = 2;`;

// S — Schema

test("S1 a fresh database ends at version 3 with all five tables", async () => {
  const f = await open();
  await f.repository.list("employee-a");
  assert.equal((f.double.engine.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 3);
  const tables = (f.double.engine.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  assert.deepEqual(tables, ["audit_snapshots", "local_drafts", "outbox_operations", "synchronized_tasks", "task_sync_state"]);
});

test("S2 a seeded v2 database upgrades to v3 with byte-identical rows and no DROP or DELETE", async () => {
  const double = createSqliteTestDouble();
  double.engine.exec(V2_SCHEMA);
  const legacyDraft = JSON.stringify({ id: "draft-old", employeeId: "employee-a", taskId: "task-a", payloadSchemaVersion: 1, revision: 4, createdAt: 10, savedAt: 20, payload: { content: "notes v2" } });
  double.engine.prepare("INSERT INTO local_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("employee-a", "task-a", "draft-old", 1, 4, 10, 20, legacyDraft);
  double.engine.prepare("INSERT INTO synchronized_tasks VALUES (?, ?, ?, ?)").run("employee-a", "task-a", JSON.stringify({ id: "task-a", establishment: "Centre A", service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" }), 30);
  const before = { drafts: double.engine.prepare("SELECT * FROM local_drafts").all(), cache: double.engine.prepare("SELECT * FROM synchronized_tasks").all() };
  const f = await open(double);
  assert.equal((await f.repository.read("employee-a", "task-a"))?.revision, 4);
  assert.equal((double.engine.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 3);
  assert.deepEqual({ drafts: f.dump("local_drafts"), cache: f.dump("synchronized_tasks") }, before);
  assert.ok(!double.statements.some((sql) => /\bDROP\b|\bDELETE\b/i.test(sql)), "the upgrade only creates tables");
});

test("S3 version 3 with a missing outbox table refuses to start and deletes nothing", async () => {
  const first = await open();
  await first.repository.save("employee-a", "task-a", form("kept"));
  first.double.engine.exec("DROP TABLE task_sync_state");
  const drafts = first.dump("local_drafts");
  const restarted = await first.restart();
  await assert.rejects(restarted.repository.read("employee-a", "task-a"), /schema is incomplete/);
  assert.deepEqual(restarted.dump("local_drafts"), drafts);
});

test("S4 version 4 is refused as before", async () => {
  const double = createSqliteTestDouble();
  double.engine.exec(V2_SCHEMA + "PRAGMA user_version = 4;");
  const f = await open(double);
  await assert.rejects(f.repository.list("employee-a"), /Unsupported local draft database version/);
  assert.equal((double.engine.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 4);
});

test("snapshot rows are insert-only", async () => {
  const f = await open();
  await f.repository.save("employee-a", "task-a", form("1"));
  assert.throws(() => f.double.engine.exec("UPDATE audit_snapshots SET payload_json = '{}'"), /insert-only/);
});

// O — Outbox writes

test("O1 the first save commits the draft, its snapshot and one queued item in one transaction", async () => {
  const f = await open();
  await f.repository.list("employee-a");
  const start = f.double.statements.length;
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  assert.equal(saved.revision, 1);
  const [item, ...others] = await f.repository.listOutbox("employee-a");
  assert.equal(others.length, 0);
  assert.equal(item!.kind, "sync-draft");
  assert.equal(item!.status, "queued");
  assert.equal(item!.baseRevision, 0);
  assert.equal(item!.attemptCount, 0);
  assert.match(item!.operationId, UUID);
  assert.match(item!.idempotencyKey, UUID);
  assert.notEqual(item!.operationId, item!.idempotencyKey);
  const snapshots = f.dump("audit_snapshots") as { kind: string; draft_revision: number; payload_json: string }[];
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]!.kind, "sync-draft");
  assert.equal(snapshots[0]!.payload_json, JSON.stringify(saved));
  const issued = f.double.statements.slice(start);
  const begin = issued.lastIndexOf("BEGIN EXCLUSIVE");
  const commit = issued.indexOf("COMMIT", begin);
  const inside = issued.slice(begin, commit);
  for (const table of ["INSERT INTO local_drafts", "INSERT INTO audit_snapshots", "INSERT INTO outbox_operations"]) {
    assert.ok(inside.some((sql) => sql.includes(table)), `${table} runs inside the save transaction`);
  }
});

for (const failing of [/INSERT INTO audit_snapshots/, /INSERT INTO outbox_operations/]) {
  test(`O2 a failing ${failing.source.split(" ").at(-1)} insert rolls the whole save back`, async () => {
    const f = await open();
    const first = await f.repository.save("employee-a", "task-a", form("1"));
    const before = f.dumpAll();
    f.double.failNext(failing);
    await assert.rejects(f.repository.save("employee-a", "task-a", form("2"), first.revision), /Injected SQLite failure/);
    assert.deepEqual(f.dumpAll(), before);
    assert.deepEqual(await f.repository.read("employee-a", "task-a"), first);
  });
}

test("O3 a second save supersedes a never-attempted sync-draft item", async () => {
  const f = await open();
  const first = await f.repository.save("employee-a", "task-a", form("1"));
  const second = await f.repository.save("employee-a", "task-a", form("2"), first.revision);
  const items = await f.repository.listOutbox("employee-a");
  assert.equal(items.length, 1);
  assert.deepEqual(await f.repository.readOutboxSnapshot("employee-a", items[0]!.operationId), second);
  assert.equal(f.dump("audit_snapshots").length, 1);
});

test("O4 an attempted item is kept and the next save queues behind it", async () => {
  const f = await open();
  const first = await f.repository.save("employee-a", "task-a", form("1"));
  const [attempted] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", attempted!.operationId, { type: "attempt-start", at: 5_000 });
  const snapshotBefore = f.dump("audit_snapshots");
  const second = await f.repository.save("employee-a", "task-a", form("2"), first.revision);
  const items = await f.repository.listOutbox("employee-a");
  assert.deepEqual(items.map((item) => item.operationId).slice(0, 1), [attempted!.operationId]);
  assert.equal(items.length, 2);
  assert.ok(items[0]!.sequence < items[1]!.sequence);
  assert.deepEqual(f.dump("audit_snapshots").slice(0, 1), snapshotBefore, "the first snapshot is unchanged");
  assert.deepEqual(await f.repository.readOutboxSnapshot("employee-a", items[1]!.operationId), second);
});

test("O5 a save with the same payload creates no item", async () => {
  const f = await open();
  const first = await f.repository.save("employee-a", "task-a", form("1"));
  const before = f.dumpAll();
  assert.deepEqual(await f.repository.save("employee-a", "task-a", form("1"), first.revision), first);
  assert.deepEqual(f.dumpAll(), before);
});

test("O6 requestSubmission saves the payload and queues a submit snapshot after attempted items only", async () => {
  const f = await open();
  const first = await f.repository.save("employee-a", "task-a", form("1"));
  const [attempted] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", attempted!.operationId, { type: "attempt-start", at: 5_000 });
  const second = await f.repository.save("employee-a", "task-a", form("2"), first.revision);
  const { draft, operation } = await f.repository.requestSubmission("employee-a", "task-a", form("final"), second.revision);
  assert.equal(draft.revision, 3);
  assert.deepEqual(await f.repository.read("employee-a", "task-a"), draft);
  const items = await f.repository.listOutbox("employee-a");
  assert.deepEqual(items.map((item) => [item.operationId, item.kind]), [[attempted!.operationId, "sync-draft"], [operation.operationId, "submit"]],
    "the never-attempted sync-draft item is superseded; the attempted one stays first");
  assert.equal(operation.status, "queued");
  assert.deepEqual(await f.repository.readOutboxSnapshot("employee-a", operation.operationId), draft);
  assert.deepEqual((f.dump("audit_snapshots") as { kind: string }[]).map((row) => row.kind), ["sync-draft", "submit"]);
  assert.deepEqual(await f.repository.getTaskSyncStatus("employee-a", "task-a"), { hasPendingSubmission: true, unresolvedCount: 2, lastOutcome: null });
});

test("O6 requestSubmission with an unchanged payload snapshots the stored revision", async () => {
  const f = await open();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  const { draft, operation } = await f.repository.requestSubmission("employee-a", "task-a", form("1"), saved.revision);
  assert.deepEqual(draft, saved);
  assert.deepEqual(await f.repository.readOutboxSnapshot("employee-a", operation.operationId), saved);
  assert.deepEqual((await f.repository.listOutbox("employee-a")).map((item) => item.kind), ["submit"]);
});

test("O7 save, delete and deleteUnreadable are refused while a submit item is unresolved", async () => {
  const f = await open();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  await f.repository.requestSubmission("employee-a", "task-a", form("1"), saved.revision);
  const before = f.dumpAll();
  await assert.rejects(f.repository.save("employee-a", "task-a", form("2"), saved.revision), PendingSubmissionError);
  await assert.rejects(f.repository.delete("employee-a", "task-a", saved.revision), PendingSubmissionError);
  await assert.rejects(f.repository.deleteUnreadable("employee-a", "task-a"), PendingSubmissionError);
  // The adapter refuses inside its own transaction too, even when the repository check is bypassed.
  await assert.rejects(f.database.save({ ...saved, revision: 2, payload: form("2") }, saved.revision), PendingSubmissionError);
  await assert.rejects(f.database.deleteUnreadable("employee-a", "task-a"), PendingSubmissionError);
  assert.deepEqual(f.dumpAll(), before);
});

test("O8 a second submission request while one is unresolved is refused", async () => {
  const f = await open();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  await f.repository.requestSubmission("employee-a", "task-a", form("1"), saved.revision);
  const before = f.dumpAll();
  await assert.rejects(f.repository.requestSubmission("employee-a", "task-a", form("1"), saved.revision), PendingSubmissionError);
  assert.deepEqual(f.dumpAll(), before);
});

test("O9 legacy content and unreadable stored drafts cannot be submitted and nothing is written", async () => {
  const f = await open();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  let before = f.dumpAll();
  await assert.rejects(f.repository.requestSubmission("employee-a", "task-a", form("1", { legacyContent: "old notes" }), saved.revision), SubmissionNotAllowedError);
  assert.deepEqual(f.dumpAll(), before);
  f.double.engine.prepare("INSERT INTO local_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("employee-a", "task-b", "draft-old-rule", 1, 3, 100, 120,
    JSON.stringify({ id: "draft-old-rule", employeeId: "employee-a", taskId: "task-b", payloadSchemaVersion: 1, revision: 3, createdAt: 100, savedAt: 120,
      payload: { ...form("x"), ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" } }));
  before = f.dumpAll();
  await assert.rejects(f.repository.requestSubmission("employee-a", "task-b", form("x"), 3), SubmissionNotAllowedError);
  assert.deepEqual(f.dumpAll(), before);
});

test("O9 a payload that parseLocalDraft rejects cannot be submitted and nothing is written", async () => {
  const f = await open();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  const before = f.dumpAll();
  await assert.rejects(f.repository.requestSubmission("employee-a", "task-a", form("1", { ruleVersion: "0.0.0-unknown" }), saved.revision), SubmissionNotAllowedError);
  await assert.rejects(f.repository.requestSubmission("employee-a", "task-a", form("1", { values: { "header.reportNumber": 42 } as never }), saved.revision), SubmissionNotAllowedError);
  await assert.rejects(f.repository.requestSubmission("employee-a", "task-c", form("1", { catalogueId: "other-catalogue" })), SubmissionNotAllowedError);
  assert.deepEqual(f.dumpAll(), before);
  assert.deepEqual(await f.repository.getTaskSyncStatus("employee-a", "task-a"), { hasPendingSubmission: false, unresolvedCount: 1, lastOutcome: null });
});

test("O10 delete removes the draft and its unresolved sync-draft items together and keeps resolved ones", async () => {
  const f = await open();
  const first = await f.repository.save("employee-a", "task-a", form("1"));
  const [resolved] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", resolved!.operationId, { type: "attempt-start", at: 5_000 });
  await f.repository.recordOutboxTransition("employee-a", resolved!.operationId, { type: "outcome", outcome: "accepted", serverRevision: 1, at: 5_001 });
  const second = await f.repository.save("employee-a", "task-a", form("2"), first.revision);
  const [, attempted] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", attempted!.operationId, { type: "attempt-start", at: 5_002 });
  const third = await f.repository.save("employee-a", "task-a", form("3"), second.revision);
  assert.equal((await f.repository.listOutbox("employee-a")).length, 3);
  await f.repository.delete("employee-a", "task-a", third.revision);
  assert.equal(await f.repository.read("employee-a", "task-a"), null);
  const items = await f.repository.listOutbox("employee-a");
  assert.deepEqual(items.map((item) => [item.operationId, item.status]), [[resolved!.operationId, "resolved"]]);
  assert.deepEqual((f.dump("audit_snapshots") as { snapshot_id: string }[]).map((row) => row.snapshot_id), [resolved!.snapshotId]);
});

test("O11 every outbox read and delete is scoped to the employee", async () => {
  const f = await open();
  await f.repository.save("employee-a", "task-a", form("A"));
  const aItems = await f.repository.listOutbox("employee-a");
  assert.deepEqual(await f.repository.listOutbox("employee-b"), []);
  assert.deepEqual(await f.repository.getTaskSyncStatus("employee-b", "task-a"), { hasPendingSubmission: false, unresolvedCount: 0, lastOutcome: null });
  await assert.rejects(f.repository.readOutboxSnapshot("employee-b", aItems[0]!.operationId));
  await assert.rejects(f.repository.recordOutboxTransition("employee-b", aItems[0]!.operationId, { type: "attempt-start", at: 1 }));
  const b = await f.repository.save("employee-b", "task-a", form("B"));
  await f.repository.delete("employee-b", "task-a", b.revision);
  await f.repository.deleteUnreadable("employee-b", "task-a");
  assert.deepEqual(await f.repository.listOutbox("employee-a"), aItems);
  assert.equal(f.dump("audit_snapshots").length, 1);
});

test("O11 a snapshot row of another task is never returned for an operation", async () => {
  const f = await open();
  await f.repository.save("employee-a", "task-a", form("A"));
  await f.repository.save("employee-a", "task-b", form("B"));
  const [itemA, itemB] = await f.repository.listOutbox("employee-a");
  assert.equal(itemA!.taskId, "task-a");
  // Swaps the two operations' snapshot rows (same employee, other task) to simulate a damaged database.
  f.double.engine.exec("PRAGMA foreign_keys = OFF");
  f.double.engine.prepare("UPDATE outbox_operations SET snapshot_id = ? WHERE operation_id = ?").run("mislinked", itemA!.operationId);
  f.double.engine.prepare("UPDATE outbox_operations SET snapshot_id = ? WHERE operation_id = ?").run(itemA!.snapshotId, itemB!.operationId);
  f.double.engine.prepare("UPDATE outbox_operations SET snapshot_id = ? WHERE operation_id = ?").run(itemB!.snapshotId, itemA!.operationId);
  f.double.engine.exec("PRAGMA foreign_keys = ON");
  await assert.rejects(f.repository.readOutboxSnapshot("employee-a", itemA!.operationId), OutboxOperationNotFoundError);
  await assert.rejects(f.repository.readOutboxSnapshot("employee-a", itemB!.operationId), OutboxOperationNotFoundError);
});

test("O12 the authorization wrapper refuses outbox reads and submission requests while locked", async () => {
  const f = await open();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  const [item] = await f.repository.listOutbox("employee-a");
  const authorized = createAuthorizedDrafts(f.repository, async () => { throw new Error("Protected data locked"); });
  const before = f.dumpAll();
  await assert.rejects(authorized.listOutbox("employee-a"), /locked/);
  await assert.rejects(authorized.getTaskSyncStatus("employee-a", "task-a"), /locked/);
  await assert.rejects(authorized.readOutboxSnapshot("employee-a", item!.operationId), /locked/);
  await assert.rejects(authorized.recordOutboxTransition("employee-a", item!.operationId, { type: "attempt-start", at: 1 }), /locked/);
  await assert.rejects(authorized.requestSubmission("employee-a", "task-a", form("1"), saved.revision), /locked/);
  assert.deepEqual(f.dumpAll(), before);
});

// P — Preservation

test("P1 a restart keeps every unresolved item and snapshot byte-identical", async () => {
  const f = await open();
  const first = await f.repository.save("employee-a", "task-a", form("1"));
  const [attempted] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", attempted!.operationId, { type: "attempt-start", at: 5_000 });
  await f.repository.requestSubmission("employee-a", "task-a", form("2"), first.revision);
  await f.repository.save("employee-a", "task-b", form("other task"));
  const before = f.dumpAll();
  const items = await f.repository.listOutbox("employee-a");
  const restarted = await f.restart();
  assert.deepEqual(await restarted.repository.listOutbox("employee-a"), items);
  assert.deepEqual(restarted.dumpAll(), before);
});

test("P2 logout, expiry and cached-task revocation leave items and snapshots untouched", async () => {
  const f = await open();
  const values = new Map<string, string>();
  const secureStore = {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string) { values.set(key, value); },
    async remove(key: string) { values.delete(key); },
  };
  let now = 1_000;
  const authorization = createOfflineAuthorizationService(secureStore, { now: () => now });
  const identity = { id: "employee-a", email: "a@example.test", displayName: "A", role: "employe" as const, mustChangePassword: false };
  await authorization.establishOnlineAuthorization(identity);
  const authorized = createAuthorizedDrafts(f.repository, (id, operation) => authorization.withProtectedAccess(id, operation));
  await authorized.cacheSynchronizedTask(identity.id, { id: "task-a", establishment: "Centre A", service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" });
  const saved = await authorized.save(identity.id, "task-a", form("1"));
  await authorized.requestSubmission(identity.id, "task-b", form("submitted"));
  const keep = () => ({ snapshots: f.dump("audit_snapshots"), outbox: f.dump("outbox_operations"), drafts: f.dump("local_drafts") });
  const before = keep();

  await authorized.revokeCachedSynchronizedTask(identity.id, "task-a");
  assert.deepEqual(keep(), before, "revoking a cached task keeps outbox items");
  now += 365 * 24 * 60 * 60 * 1000;
  await assert.rejects(authorized.listOutbox(identity.id));
  await assert.rejects(authorized.save(identity.id, "task-a", form("2"), saved.revision));
  assert.deepEqual(keep(), before, "offline-authorization expiry keeps outbox items");
  await authorization.logout(identity.id);
  await assert.rejects(authorized.listOutbox(identity.id));
  assert.deepEqual(keep(), before, "logout keeps outbox items");
});
