import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import { createAuthorizedDrafts } from "./authorized-drafts.js";
import {
  ConflictResolutionError, createDraftRepository, OpenConflictError, PendingSubmissionError,
  type DraftRepository, type GraphieDraftPayload, type OutboxItem,
} from "./model.js";
import { createSqliteTestDouble, type SqliteTestDouble } from "../test-support/sqlite-test-double.js";

// Story 8.1: explicit conflict resolution in the local store (schema v4).

mock.module("expo-sqlite", { namedExports: { openDatabaseAsync: async () => { throw new Error("unused default driver"); } } });
mock.module("expo-crypto", { namedExports: { getRandomBytesAsync: async (length: number) => new Uint8Array(length) } });

async function open(double: SqliteTestDouble = createSqliteTestDouble()) {
  const { createSqliteDraftDatabase } = await import("./sqlite-draft-database.js");
  const secrets = new Map<string, string>();
  const store = {
    async get(key: string) { return secrets.get(key) ?? null; },
    async set(key: string, value: string) { secrets.set(key, value); },
    async remove(key: string) { secrets.delete(key); },
  };
  const database = createSqliteDraftDatabase(store, double.driver as never, async (length) => new Uint8Array(length).fill(0xab));
  let time = 1_000;
  let id = 0;
  const repository = createDraftRepository(database, () => ++time, () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`);
  const dump = (table: string) => double.engine.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const dumpAll = () => ({
    drafts: dump("local_drafts"), snapshots: dump("audit_snapshots"), outbox: dump("outbox_operations"), state: dump("task_sync_state"),
    resolutions: dump("conflict_resolutions"), resolutionItems: dump("conflict_resolution_items"),
  });
  return { double, database, repository, dump, dumpAll };
}

const form = (reportNumber: string, values: Record<string, string> = {}): GraphieDraftPayload => ({
  catalogueId: GRAPHIE_CALCULATION_IDENTITY.catalogueId,
  catalogueVersion: GRAPHIE_CALCULATION_IDENTITY.catalogueVersion,
  schemaVersion: GRAPHIE_CALCULATION_IDENTITY.schemaVersion,
  ruleId: GRAPHIE_CALCULATION_IDENTITY.ruleId,
  ruleVersion: GRAPHIE_CALCULATION_IDENTITY.ruleVersion,
  values: { "header.reportNumber": reportNumber, ...values },
});

const conflictDetail = { revision: 2, state: "draft", lastChangedAt: "2026-10-04T08:00:00.000Z", lastChangedBy: { id: "employee-a", displayName: "Employé Test" } };

/** Sends the item and records a 409 for it. */
async function conflict(repository: DraftRepository, item: OutboxItem, at = 5_000) {
  await repository.recordOutboxTransition(item.employeeId, item.operationId, { type: "attempt-start", at });
  return repository.recordOutboxTransition(item.employeeId, item.operationId, { type: "outcome", outcome: "conflict", serverRevision: 2, detail: conflictDetail, at: at + 1 });
}

/** A draft conflict: the first sync-draft conflicted; returns the local draft and the conflicted item. */
async function draftConflict(repository: DraftRepository, employeeId = "employee-a", taskId = "task-a") {
  const draft = await repository.save(employeeId, taskId, form("local"));
  const [item] = (await repository.listOutbox(employeeId)).filter((entry) => entry.taskId === taskId);
  return { draft, conflicted: await conflict(repository, item!) };
}

const V3_SCHEMA = `
  CREATE TABLE local_drafts (
    employee_id TEXT NOT NULL, task_id TEXT NOT NULL, draft_id TEXT NOT NULL UNIQUE, payload_schema_version INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0), created_at INTEGER NOT NULL, saved_at INTEGER NOT NULL, payload_json TEXT NOT NULL,
    PRIMARY KEY (employee_id, task_id));
  CREATE TABLE synchronized_tasks (employee_id TEXT NOT NULL, task_id TEXT NOT NULL, task_json TEXT NOT NULL, synchronized_at INTEGER NOT NULL,
    PRIMARY KEY (employee_id, task_id));
  CREATE TABLE audit_snapshots (snapshot_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, task_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('sync-draft', 'submit')), draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
    payload_json TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE outbox_operations (operation_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, employee_id TEXT NOT NULL,
    task_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('sync-draft', 'submit')),
    snapshot_id TEXT NOT NULL UNIQUE REFERENCES audit_snapshots(snapshot_id), base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
    status TEXT NOT NULL CHECK (status IN ('queued', 'in-flight', 'retry-paused', 'blocked', 'resolved')), attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, outcome TEXT CHECK (outcome IN ('accepted', 'rejected', 'conflict')), outcome_json TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, resolved_at INTEGER, CHECK ((status = 'resolved') = (outcome IS NOT NULL)));
  CREATE TABLE task_sync_state (employee_id TEXT NOT NULL, task_id TEXT NOT NULL, server_revision INTEGER NOT NULL CHECK (server_revision >= 0),
    updated_at INTEGER NOT NULL, PRIMARY KEY (employee_id, task_id));
  PRAGMA user_version = 3;`;

test("O1 the v3 upgrade (through v4 and the Story 8.2 v5) keeps every row of the five existing tables; a version above 5 is refused", async () => {
  const double = createSqliteTestDouble();
  double.engine.exec(V3_SCHEMA);
  const draft = { id: "draft-1", employeeId: "employee-a", taskId: "task-a", payloadSchemaVersion: 1, revision: 2, createdAt: 10, savedAt: 20, payload: form("v3") };
  double.engine.prepare("INSERT INTO local_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("employee-a", "task-a", "draft-1", 1, 2, 10, 20, JSON.stringify(draft));
  double.engine.prepare("INSERT INTO synchronized_tasks VALUES (?, ?, ?, ?)").run("employee-a", "task-a", JSON.stringify({ id: "task-a", establishment: "Établissement A", service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" }), 30);
  double.engine.prepare("INSERT INTO audit_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)").run("snap-1", "employee-a", "task-a", "sync-draft", 2, JSON.stringify(draft), 20);
  double.engine.prepare(`INSERT INTO outbox_operations (operation_id, idempotency_key, employee_id, task_id, sequence, kind, snapshot_id, base_revision,
    status, attempt_count, last_error, outcome, outcome_json, created_at, updated_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("op-1", "key-1", "employee-a", "task-a", 1, "sync-draft", "snap-1", 0, "resolved", 1, null, "conflict", JSON.stringify({ serverRevision: 2, detail: conflictDetail }), 20, 21, 21);
  double.engine.prepare("INSERT INTO task_sync_state VALUES (?, ?, ?, ?)").run("employee-a", "task-a", 1, 15);
  const tables = ["local_drafts", "synchronized_tasks", "audit_snapshots", "outbox_operations", "task_sync_state"];
  const before = Object.fromEntries(tables.map((table) => [table, double.engine.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const f = await open(double);
  const [item] = await f.repository.listOutbox("employee-a");
  assert.equal((double.engine.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 5);
  for (const table of tables.filter((table) => table !== "outbox_operations")) assert.deepEqual(f.dump(table), before[table], table);
  assert.deepEqual(f.dump("outbox_operations").map((row) => ({ ...(row as object) })), (before.outbox_operations as Record<string, unknown>[]).map((row) => ({ ...row, conflict_operation_id: null, correction_operation_id: null })));
  assert.deepEqual([item!.outcome, item!.conflictOperationId, item!.conflictResolutionId], ["conflict", null, null], "a conflict stored before 8.1 is open");
  assert.ok(!double.statements.some((sql) => /\bDROP\b|\bDELETE\b/i.test(sql)));

  const newer = createSqliteTestDouble();
  newer.engine.exec(V3_SCHEMA.replace("PRAGMA user_version = 3;", "PRAGMA user_version = 6;"));
  await assert.rejects((await open(newer)).repository.list("employee-a"), /Unsupported local draft database version/);
});

test("O2 while a draft conflict is open, save stays local and the other writes are refused without change", async () => {
  const f = await open();
  const { draft } = await draftConflict(f.repository);
  const outbox = f.dump("outbox_operations");
  const snapshots = f.dump("audit_snapshots");
  const saved = await f.repository.save("employee-a", "task-a", form("edited offline"), draft.revision);
  assert.equal(saved.revision, 2);
  assert.deepEqual(await f.repository.read("employee-a", "task-a"), saved);
  assert.deepEqual([f.dump("outbox_operations"), f.dump("audit_snapshots")], [outbox, snapshots], "no snapshot and no item");
  const before = f.dumpAll();
  await assert.rejects(f.repository.requestSubmission("employee-a", "task-a", form("edited offline"), saved.revision), OpenConflictError);
  await assert.rejects(f.repository.delete("employee-a", "task-a", saved.revision), OpenConflictError);
  await assert.rejects(f.repository.deleteUnreadable("employee-a", "task-a"), OpenConflictError);
  // The adapter refuses inside its own transaction too.
  await assert.rejects(f.database.deleteUnreadable("employee-a", "task-a"), OpenConflictError);
  await assert.rejects(f.database.delete("employee-a", "task-a", saved.revision), OpenConflictError);
  assert.deepEqual(f.dumpAll(), before);
});

test("O3 keep-local on a draft conflict commits the resolution, withdraws never-attempted items and queues one new item", async () => {
  const f = await open();
  const first = await f.repository.save("employee-a", "task-a", form("1"));
  const [attempted] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", attempted!.operationId, { type: "attempt-start", at: 2_000 });
  const second = await f.repository.save("employee-a", "task-a", form("2"), first.revision);
  const [, waiting] = await f.repository.listOutbox("employee-a");
  const conflicted = await f.repository.recordOutboxTransition("employee-a", attempted!.operationId, { type: "outcome", outcome: "conflict", serverRevision: 5, detail: conflictDetail, at: 2_001 });
  const before = f.dumpAll();

  f.double.failNext(/INSERT INTO outbox_operations/);
  await assert.rejects(f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [conflicted.operationId], server: { revision: 5, state: "draft" } }), /Injected SQLite failure/);
  assert.deepEqual(f.dumpAll(), before, "a failure before commit leaves everything unchanged");

  const { draft, operation } = await f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [conflicted.operationId], server: { revision: 5, state: "draft" } });
  assert.deepEqual(draft, second, "the local draft is the preserved local version");
  assert.deepEqual(await f.repository.read("employee-a", "task-a"), second);
  assert.deepEqual([operation.kind, operation.status, operation.baseRevision, operation.conflictOperationId, operation.attemptCount], ["sync-draft", "queued", 5, conflicted.operationId, 0]);
  assert.deepEqual(await f.repository.readOutboxSnapshot("employee-a", operation.operationId), second);
  const [resolution] = await f.repository.listConflictResolutions("employee-a");
  assert.deepEqual({ ...resolution!, createdAt: 0 }, {
    resolutionId: resolution!.resolutionId, employeeId: "employee-a", taskId: "task-a", choice: "keep-local", serverRevision: 5, serverState: "draft",
    newOperationId: operation.operationId, createdAt: 0,
    items: [
      { operationId: conflicted.operationId, role: "conflict", kind: "sync-draft", snapshotId: conflicted.snapshotId },
      { operationId: waiting!.operationId, role: "withdrawn", kind: "sync-draft", snapshotId: waiting!.snapshotId },
    ],
  });
  const items = await f.repository.listOutbox("employee-a");
  assert.deepEqual(items.map((item) => [item.operationId, item.conflictResolutionId]), [[conflicted.operationId, resolution!.resolutionId], [operation.operationId, null]]);
  assert.ok(f.dump("audit_snapshots").some((row) => (row as { snapshot_id: string }).snapshot_id === waiting!.snapshotId), "the withdrawn snapshot is kept");
  assert.deepEqual(f.dump("task_sync_state").map((row) => (row as { server_revision: number }).server_revision), [5]);
  assert.throws(() => f.double.engine.exec("UPDATE conflict_resolutions SET server_revision = 1"), /insert-only/);
  assert.throws(() => f.double.engine.exec("UPDATE conflict_resolution_items SET role = 'conflict'"), /insert-only/);
});

test("O4 keep-local on a submit conflict, and on a draft conflict with a submit behind it, leaves no unresolved submit", async () => {
  const f = await open();
  const saved = await f.repository.save("employee-a", "task-a", form("1"));
  const [syncDraft] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", syncDraft!.operationId, { type: "attempt-start", at: 2_000 });
  const { operation: submit } = await f.repository.requestSubmission("employee-a", "task-a", form("1"), saved.revision);
  const conflicted = await f.repository.recordOutboxTransition("employee-a", syncDraft!.operationId, { type: "outcome", outcome: "conflict", serverRevision: 3, detail: conflictDetail, at: 2_001 });
  await assert.rejects(f.repository.save("employee-a", "task-a", form("2"), saved.revision), PendingSubmissionError, "a queued submit keeps the task read-only");
  const result = await f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [conflicted.operationId], server: { revision: 3, state: "draft" } });
  assert.equal(result.operation.kind, "sync-draft");
  const items = await f.repository.listOutbox("employee-a");
  assert.ok(!items.some((item) => item.kind === "submit" && item.status !== "resolved"));
  const [resolution] = await f.repository.listConflictResolutions("employee-a");
  assert.deepEqual(resolution!.items.map((item) => [item.role, item.kind]), [["conflict", "sync-draft"], ["withdrawn", "submit"]]);
  const submitSnapshot = f.double.engine.prepare("SELECT kind FROM audit_snapshots WHERE snapshot_id = ?").get(submit.snapshotId) as { kind: string } | undefined;
  assert.equal(submitSnapshot?.kind, "submit", "the submission snapshot stays readable");

  const g = await open();
  const draft = await g.repository.save("employee-a", "task-b", form("submitted"));
  const { operation } = await g.repository.requestSubmission("employee-a", "task-b", form("submitted"), draft.revision);
  const submitConflict = await conflict(g.repository, operation);
  const kept = await g.repository.resolveConflictKeepLocal("employee-a", "task-b", { conflictOperationIds: [submitConflict.operationId], server: { revision: 2, state: "draft" } });
  assert.deepEqual([kept.operation.kind, kept.operation.conflictOperationId], ["sync-draft", submitConflict.operationId]);
  assert.ok((g.dump("audit_snapshots") as { snapshot_id: string }[]).some((row) => row.snapshot_id === submitConflict.snapshotId));
});

test("O5 discard-local replaces the local draft with the server payload, deletes it without audit, and records the server state", async () => {
  const f = await open();
  const { draft, conflicted } = await draftConflict(f.repository);
  const result = await f.repository.resolveConflictDiscardLocal("employee-a", "task-a", { conflictOperationIds: [conflicted.operationId], server: { revision: 2, state: "draft", payload: form("serveur", { "comments.general": "Commentaire serveur" }) } });
  assert.deepEqual([result.draft?.revision, result.draft?.id, result.draft?.payload], [draft.revision + 1, draft.id, form("serveur", { "comments.general": "Commentaire serveur" })]);
  assert.deepEqual(await f.repository.read("employee-a", "task-a"), result.draft);
  assert.deepEqual(f.dump("outbox_operations").length, 1, "nothing is queued");
  assert.deepEqual(f.dump("task_sync_state").map((row) => (row as { server_revision: number }).server_revision), [2]);

  const g = await open();
  const none = await draftConflict(g.repository);
  assert.deepEqual(await g.repository.resolveConflictDiscardLocal("employee-a", "task-a", { conflictOperationIds: [none.conflicted.operationId], server: { revision: 0, state: "draft", payload: null } }), { draft: null });
  assert.equal(await g.repository.read("employee-a", "task-a"), null);

  const h = await open();
  const submitted = await draftConflict(h.repository);
  await h.repository.resolveConflictDiscardLocal("employee-a", "task-a", { conflictOperationIds: [submitted.conflicted.operationId], server: { revision: 4, state: "submitted", payload: form("accepté") } });
  assert.deepEqual((await h.repository.listConflictResolutions("employee-a")).map((entry) => [entry.choice, entry.serverState, entry.serverRevision, entry.newOperationId]), [["discard-local", "submitted", 4, null]]);

  const u = await open();
  const unreadable = await draftConflict(u.repository);
  const before = u.dumpAll();
  await assert.rejects(u.repository.resolveConflictDiscardLocal("employee-a", "task-a", { conflictOperationIds: [unreadable.conflicted.operationId], server: { revision: 2, state: "draft", payload: { ...form("x"), ruleVersion: "9.9.9" } } }),
    (error: unknown) => error instanceof ConflictResolutionError && error.reason === "server-unreadable");
  assert.deepEqual(u.dumpAll(), before);
});

test("O6 stale panels, attempted items, a submitted server and a missing or unreadable draft are refused without change", async () => {
  const f = await open();
  const { draft, conflicted } = await draftConflict(f.repository);
  const before = f.dumpAll();
  const refusals: Array<[Promise<unknown>, ConflictResolutionError["reason"]]> = [
    [f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [], server: { revision: 2, state: "draft" } }), "stale"],
    [f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [conflicted.operationId, "other"], server: { revision: 2, state: "draft" } }), "stale"],
    [f.repository.resolveConflictDiscardLocal("employee-a", "task-a", { conflictOperationIds: ["other"], server: { revision: 2, state: "draft", payload: null } }), "stale"],
    [f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [conflicted.operationId], server: { revision: 2, state: "submitted" as "draft" } }), "server-submitted"],
  ];
  for (const [attempt, reason] of refusals) {
    await assert.rejects(attempt, (error: unknown) => error instanceof ConflictResolutionError && error.reason === reason);
  }
  assert.deepEqual(f.dumpAll(), before);

  // An attempted unresolved item (data from before 8.1) blocks the resolution.
  f.double.engine.prepare(`INSERT INTO audit_snapshots VALUES ('snap-x', 'employee-a', 'task-a', 'sync-draft', 1, ?, 1)`).run(JSON.stringify(draft));
  f.double.engine.prepare(`INSERT INTO outbox_operations (operation_id, idempotency_key, employee_id, task_id, sequence, kind, snapshot_id, base_revision, status,
    attempt_count, created_at, updated_at) VALUES ('op-x', 'key-x', 'employee-a', 'task-a', 99, 'sync-draft', 'snap-x', 0, 'retry-paused', 3, 1, 1)`).run();
  const withAttempted = f.dumpAll();
  await assert.rejects(f.repository.resolveConflictDiscardLocal("employee-a", "task-a", { conflictOperationIds: [conflicted.operationId], server: { revision: 2, state: "draft", payload: null } }),
    (error: unknown) => error instanceof ConflictResolutionError && error.reason === "attempted");
  assert.deepEqual(f.dumpAll(), withAttempted);

  const g = await open();
  const missing = await draftConflict(g.repository, "employee-a", "task-b");
  g.double.engine.exec("DELETE FROM local_drafts");
  const gBefore = g.dumpAll();
  await assert.rejects(g.repository.resolveConflictKeepLocal("employee-a", "task-b", { conflictOperationIds: [missing.conflicted.operationId], server: { revision: 2, state: "draft" } }),
    (error: unknown) => error instanceof ConflictResolutionError && error.reason === "local-unavailable");
  g.double.engine.prepare("INSERT INTO local_drafts VALUES ('employee-a', 'task-b', 'draft-old', 1, 3, 1, 2, ?)").run(JSON.stringify({ ...missing.draft, revision: 3, payload: { ...form("x"), ruleId: "ancienne-regle" } }));
  await assert.rejects(g.repository.resolveConflictKeepLocal("employee-a", "task-b", { conflictOperationIds: [missing.conflicted.operationId], server: { revision: 2, state: "draft" } }),
    (error: unknown) => error instanceof ConflictResolutionError && error.reason === "local-unavailable");
  assert.deepEqual({ ...g.dumpAll(), drafts: [] }, { ...gBefore, drafts: [] });
});

test("O7 a later save or submission supersedes the never-attempted keep-local item and keeps its conflict lineage", async () => {
  const f = await open();
  const { conflicted } = await draftConflict(f.repository);
  const { draft } = await f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [conflicted.operationId], server: { revision: 2, state: "draft" } });
  const saved = await f.repository.save("employee-a", "task-a", form("after keep-local"), draft.revision);
  let pending = (await f.repository.listOutbox("employee-a")).filter((item) => item.status !== "resolved");
  assert.deepEqual(pending.map((item) => [item.kind, item.conflictOperationId, item.baseRevision]), [["sync-draft", conflicted.operationId, 2]]);
  await f.repository.requestSubmission("employee-a", "task-a", form("after keep-local"), saved.revision);
  pending = (await f.repository.listOutbox("employee-a")).filter((item) => item.status !== "resolved");
  assert.deepEqual(pending.map((item) => [item.kind, item.conflictOperationId, item.baseRevision]), [["submit", conflicted.operationId, 2]]);
});

test("O8 employee B's rows are never read, resolved or withdrawn by employee A's calls", async () => {
  const f = await open();
  const a = await draftConflict(f.repository, "employee-a", "task-a");
  const b = await draftConflict(f.repository, "employee-b", "task-a");
  await f.repository.save("employee-b", "task-a", form("B offline"), b.draft.revision);
  const bRows = () => ({
    drafts: f.double.engine.prepare("SELECT * FROM local_drafts WHERE employee_id = 'employee-b'").all(),
    outbox: f.double.engine.prepare("SELECT * FROM outbox_operations WHERE employee_id = 'employee-b'").all(),
    state: f.double.engine.prepare("SELECT * FROM task_sync_state WHERE employee_id = 'employee-b'").all(),
  });
  const before = bRows();
  await assert.rejects(f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [b.conflicted.operationId], server: { revision: 2, state: "draft" } }), ConflictResolutionError);
  await f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [a.conflicted.operationId], server: { revision: 2, state: "draft" } });
  assert.deepEqual(bRows(), before);
  assert.deepEqual(await f.repository.listConflictResolutions("employee-b"), []);
  assert.equal((await f.repository.listOutbox("employee-b"))[0]!.conflictResolutionId, null, "B's conflict stays open");
  const authorized = createAuthorizedDrafts(f.repository, async () => { throw new Error("Protected data locked"); });
  await assert.rejects(authorized.resolveConflictDiscardLocal("employee-b", "task-a", { conflictOperationIds: [b.conflicted.operationId], server: { revision: 2, state: "draft", payload: null } }), /locked/);
  await assert.rejects(authorized.listConflictResolutions("employee-b"), /locked/);
  assert.deepEqual(bRows(), before);
});
