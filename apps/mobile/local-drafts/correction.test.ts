import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import { createAuthorizedDrafts } from "./authorized-drafts.js";
import {
  CorrectionDraftError, createDraftRepository, SubmissionNotAllowedError, SubmissionValidationError,
  type DraftRepository, type GraphieDraftPayload, type OutboxItem,
} from "./model.js";
import { createSqliteTestDouble, type SqliteTestDouble } from "../test-support/sqlite-test-double.js";

// Story 8.2: correction drafts after a refused submission in the local store (schema v5).

mock.module("expo-sqlite", { namedExports: { openDatabaseAsync: async () => { throw new Error("unused default driver"); } } });
mock.module("expo-crypto", { namedExports: { getRandomBytesAsync: async (length: number) => new Uint8Array(length) } });

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
  const repository = createDraftRepository(database, () => ++time, () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`);
  const dump = (table: string) => double.engine.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const dumpAll = () => ({
    drafts: dump("local_drafts"), snapshots: dump("audit_snapshots"), outbox: dump("outbox_operations"), state: dump("task_sync_state"),
    resolutions: dump("conflict_resolutions"), resolutionItems: dump("conflict_resolution_items"), corrections: dump("correction_drafts"),
  });
  return { double, database, repository, dump, dumpAll, restart: () => open(double, secrets) };
}

const form = (reportNumber: string, values: Record<string, string> = {}): GraphieDraftPayload => ({
  catalogueId: GRAPHIE_CALCULATION_IDENTITY.catalogueId,
  catalogueVersion: GRAPHIE_CALCULATION_IDENTITY.catalogueVersion,
  schemaVersion: GRAPHIE_CALCULATION_IDENTITY.schemaVersion,
  ruleId: GRAPHIE_CALCULATION_IDENTITY.ruleId,
  ruleVersion: GRAPHIE_CALCULATION_IDENTITY.ruleVersion,
  values: { "header.reportNumber": reportNumber, ...values },
});

const ISSUES = [{ path: "values.header.reportNumber", code: "unknown-option" }];

/** Sends the item and records the given outcome for it. */
async function resolve(repository: DraftRepository, item: OutboxItem, outcome: "accepted" | "rejected" | "conflict", detail?: unknown, at = 5_000) {
  await repository.recordOutboxTransition(item.employeeId, item.operationId, { type: "attempt-start", at });
  return repository.recordOutboxTransition(item.employeeId, item.operationId, {
    type: "outcome", outcome, ...(outcome === "rejected" ? {} : { serverRevision: 1 }), ...(detail === undefined ? {} : { detail }), at: at + 1,
  });
}

/** A submission the server refused with a stored 422; returns the submitted draft and the refused item. */
async function refusedSubmission(repository: DraftRepository, taskId = "task-a", code = "INVALID_PAYLOAD", employeeId = "employee-a") {
  const draft = await repository.save(employeeId, taskId, form("refusé"));
  const { operation } = await repository.requestSubmission(employeeId, taskId, form("refusé"), draft.revision);
  const [syncDraft] = (await repository.listOutbox(employeeId)).filter((item) => item.taskId === taskId && item.kind === "sync-draft" && item.status !== "resolved");
  if (syncDraft) await resolve(repository, syncDraft, "accepted", undefined, 4_000);
  const refused = await resolve(repository, operation, "rejected", { code, issues: ISSUES });
  return { draft, refused };
}

const V4_SCHEMA = `
  CREATE TABLE local_drafts (employee_id TEXT NOT NULL, task_id TEXT NOT NULL, draft_id TEXT NOT NULL UNIQUE, payload_schema_version INTEGER NOT NULL,
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
    updated_at INTEGER NOT NULL, resolved_at INTEGER, conflict_operation_id TEXT, CHECK ((status = 'resolved') = (outcome IS NOT NULL)));
  CREATE TABLE task_sync_state (employee_id TEXT NOT NULL, task_id TEXT NOT NULL, server_revision INTEGER NOT NULL CHECK (server_revision >= 0),
    updated_at INTEGER NOT NULL, PRIMARY KEY (employee_id, task_id));
  CREATE TABLE conflict_resolutions (resolution_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, task_id TEXT NOT NULL,
    choice TEXT NOT NULL CHECK (choice IN ('keep-local', 'discard-local')), server_revision INTEGER NOT NULL CHECK (server_revision >= 0),
    server_state TEXT NOT NULL CHECK (server_state IN ('draft', 'submitted')), new_operation_id TEXT, created_at INTEGER NOT NULL,
    CHECK ((choice = 'keep-local') = (new_operation_id IS NOT NULL)));
  CREATE TABLE conflict_resolution_items (operation_id TEXT PRIMARY KEY, resolution_id TEXT NOT NULL REFERENCES conflict_resolutions(resolution_id),
    employee_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('conflict', 'withdrawn')), kind TEXT NOT NULL CHECK (kind IN ('sync-draft', 'submit')),
    snapshot_id TEXT NOT NULL);
  PRAGMA user_version = 4;`;

test("S5 the v4 to v5 upgrade keeps every row and adds the column, table and trigger; a v5 database missing correction_drafts is refused", async () => {
  const double = createSqliteTestDouble();
  double.engine.exec(V4_SCHEMA);
  const draft = { id: "draft-1", employeeId: "employee-a", taskId: "task-a", payloadSchemaVersion: 1, revision: 2, createdAt: 10, savedAt: 20, payload: form("v4") };
  double.engine.prepare("INSERT INTO local_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("employee-a", "task-a", "draft-1", 1, 2, 10, 20, JSON.stringify(draft));
  double.engine.prepare("INSERT INTO synchronized_tasks VALUES (?, ?, ?, ?)").run("employee-a", "task-a", JSON.stringify({ id: "task-a", establishment: "Établissement A", service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" }), 30);
  double.engine.prepare("INSERT INTO audit_snapshots VALUES (?, ?, ?, ?, ?, ?, ?)").run("snap-1", "employee-a", "task-a", "submit", 2, JSON.stringify(draft), 20);
  double.engine.prepare(`INSERT INTO outbox_operations (operation_id, idempotency_key, employee_id, task_id, sequence, kind, snapshot_id, base_revision,
    status, attempt_count, last_error, outcome, outcome_json, created_at, updated_at, resolved_at, conflict_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("op-1", "key-1", "employee-a", "task-a", 1, "submit", "snap-1", 0, "resolved", 1, null, "rejected", JSON.stringify({ detail: { code: "INVALID_PAYLOAD", issues: ISSUES } }), 20, 21, 21, null);
  double.engine.prepare("INSERT INTO task_sync_state VALUES (?, ?, ?, ?)").run("employee-a", "task-a", 0, 15);
  double.engine.prepare("INSERT INTO conflict_resolutions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("resolution-1", "employee-a", "task-b", "discard-local", 1, "draft", null, 12);
  double.engine.prepare("INSERT INTO conflict_resolution_items VALUES (?, ?, ?, ?, ?, ?)").run("op-old", "resolution-1", "employee-a", "conflict", "sync-draft", "snap-old");
  const tables = ["local_drafts", "synchronized_tasks", "audit_snapshots", "outbox_operations", "task_sync_state", "conflict_resolutions", "conflict_resolution_items"];
  const before = Object.fromEntries(tables.map((table) => [table, double.engine.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

  const f = await open(double);
  const [item] = await f.repository.listOutbox("employee-a");
  assert.equal((double.engine.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 5);
  for (const table of tables.filter((table) => table !== "outbox_operations")) assert.deepEqual(f.dump(table), before[table], table);
  assert.deepEqual(f.dump("outbox_operations").map((row) => ({ ...(row as object) })), (before.outbox_operations as Record<string, unknown>[]).map((row) => ({ ...row, correction_operation_id: null })));
  assert.deepEqual([item!.outcome, item!.correctionOperationId], ["rejected", null]);
  assert.deepEqual(f.dump("correction_drafts"), []);
  assert.ok(double.engine.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'correction_drafts_no_update'").get());
  assert.ok(!double.statements.some((sql) => /\bDROP\b|\bDELETE\b/i.test(sql)), "the upgrade deletes nothing");
  // A refusal stored before 8.2 can be corrected.
  const { correction } = await f.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: "op-1" });
  assert.deepEqual([correction.rejectedSnapshotId, correction.rejectedAt, correction.draftRevision], ["snap-1", 21, 3]);

  const restarted = await f.restart();
  assert.equal((await restarted.repository.listCorrectionDrafts("employee-a")).length, 1, "a restart at v5 is accepted");

  double.engine.exec("DROP TABLE correction_drafts");
  const drafts = restarted.dump("local_drafts");
  await assert.rejects((await restarted.restart()).repository.read("employee-a", "task-a"), /schema is incomplete/);
  assert.deepEqual(restarted.dump("local_drafts"), drafts, "nothing is deleted");
});

test("C1 a correction draft makes the refused snapshot the next local revision, records one insert-only row and queues nothing", async () => {
  const f = await open();
  const { draft, refused } = await refusedSubmission(f.repository);
  // The Employé typed more after the refusal; the correction starts again from the refused snapshot.
  const edited = await f.repository.save("employee-a", "task-a", form("après refus"), draft.revision);
  const [afterRefusal] = (await f.repository.listOutbox("employee-a")).filter((item) => item.status !== "resolved");
  await resolve(f.repository, afterRefusal!, "accepted", undefined, 6_000);
  const before = f.dumpAll();
  const start = f.double.statements.length;

  const { draft: correctionDraft, correction } = await f.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: refused.operationId });
  assert.deepEqual(correctionDraft, { ...edited, revision: edited.revision + 1, payload: form("refusé"), savedAt: correctionDraft.savedAt });
  assert.ok(correctionDraft.savedAt >= edited.savedAt);
  assert.deepEqual(await f.repository.read("employee-a", "task-a"), correctionDraft);
  assert.deepEqual(correction, {
    correctionId: correction.correctionId, employeeId: "employee-a", taskId: "task-a", rejectedOperationId: refused.operationId,
    rejectedSnapshotId: refused.snapshotId, rejectedAt: refused.resolvedAt, draftRevision: correctionDraft.revision, createdAt: correction.createdAt,
  });
  assert.deepEqual(await f.repository.listCorrectionDrafts("employee-a"), [correction]);
  const after = f.dumpAll();
  assert.deepEqual({ ...after, drafts: [], corrections: [] }, { ...before, drafts: [], corrections: [] }, "no snapshot, no item, no state change");
  assert.equal(after.corrections.length, 1);
  assert.deepEqual(await f.repository.readOutboxSnapshot("employee-a", refused.operationId), draft, "the refused snapshot is intact");

  const issued = f.double.statements.slice(start);
  const begin = issued.indexOf("BEGIN EXCLUSIVE");
  const inside = issued.slice(begin, issued.indexOf("COMMIT", begin));
  for (const write of ["INSERT INTO correction_drafts", "INSERT INTO local_drafts"]) assert.ok(inside.some((sql) => sql.includes(write)), `${write} runs inside one transaction`);
  assert.ok(!issued.some((sql) => /\bDELETE\b|INSERT INTO (outbox_operations|audit_snapshots)/.test(sql)));

  // Without a local draft row, the correction is revision 1.
  const g = await open();
  const second = await refusedSubmission(g.repository, "task-b");
  g.double.engine.exec("DELETE FROM local_drafts");
  const created = await g.repository.createCorrectionDraft("employee-a", "task-b", { rejectedOperationId: second.refused.operationId });
  assert.deepEqual([created.draft.revision, created.draft.payload, created.correction.draftRevision], [1, form("refusé"), 1]);
});

test("C2 every refusal reason writes nothing", async () => {
  const reasonOf = (reason: CorrectionDraftError["reason"]) => (error: unknown) => error instanceof CorrectionDraftError && error.reason === reason;

  // stale: a newer submit exists.
  const newer = await open();
  const a = await refusedSubmission(newer.repository);
  await newer.repository.requestSubmission("employee-a", "task-a", form("refusé"), a.draft.revision);
  let before = newer.dumpAll();
  await assert.rejects(newer.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: a.refused.operationId }), reasonOf("stale"));
  assert.deepEqual(newer.dumpAll(), before);

  // stale: already corrected; and an operation that is not the open refusal.
  const corrected = await open();
  const b = await refusedSubmission(corrected.repository);
  await corrected.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: b.refused.operationId });
  before = corrected.dumpAll();
  await assert.rejects(corrected.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: b.refused.operationId }), reasonOf("stale"));
  await assert.rejects(corrected.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: "other" }), reasonOf("stale"));
  assert.deepEqual(corrected.dumpAll(), before);

  // stale: AUDIT_ALREADY_SUBMITTED is never corrected here (8.3/8.4).
  const accepted = await open();
  const c = await refusedSubmission(accepted.repository, "task-a", "AUDIT_ALREADY_SUBMITTED");
  before = accepted.dumpAll();
  await assert.rejects(accepted.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: c.refused.operationId }), reasonOf("stale"));
  assert.deepEqual(accepted.dumpAll(), before);

  // open-conflict: a later sync-draft conflicted.
  const conflicted = await open();
  const d = await refusedSubmission(conflicted.repository);
  await conflicted.repository.save("employee-a", "task-a", form("plus tard"), d.draft.revision);
  const [later] = (await conflicted.repository.listOutbox("employee-a")).filter((item) => item.status !== "resolved");
  await resolve(conflicted.repository, later!, "conflict", { revision: 2 }, 7_000);
  before = conflicted.dumpAll();
  await assert.rejects(conflicted.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: d.refused.operationId }), reasonOf("open-conflict"));
  assert.deepEqual(conflicted.dumpAll(), before);

  // unresolved: a later sync-draft is still queued.
  const unresolved = await open();
  const e = await refusedSubmission(unresolved.repository);
  await unresolved.repository.save("employee-a", "task-a", form("en attente"), e.draft.revision);
  before = unresolved.dumpAll();
  await assert.rejects(unresolved.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: e.refused.operationId }), reasonOf("unresolved"));
  assert.deepEqual(unresolved.dumpAll(), before);

  // snapshot-unavailable: missing, unreadable, or of another scope.
  for (const damage of ["missing", "unreadable", "other-scope"] as const) {
    const g = await open();
    const h = await refusedSubmission(g.repository);
    if (damage !== "missing") {
      const payload = damage === "unreadable" ? "{}" : JSON.stringify({ ...h.draft, taskId: "task-z" });
      g.double.engine.prepare("INSERT INTO audit_snapshots VALUES ('snap-damaged', 'employee-a', 'task-a', 'submit', 1, ?, 1)").run(payload);
    }
    g.double.engine.exec("PRAGMA foreign_keys = OFF");
    g.double.engine.prepare("UPDATE outbox_operations SET snapshot_id = ? WHERE operation_id = ?").run(damage === "missing" ? "snap-missing" : "snap-damaged", h.refused.operationId);
    g.double.engine.exec("PRAGMA foreign_keys = ON");
    before = g.dumpAll();
    await assert.rejects(g.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: h.refused.operationId }), reasonOf("snapshot-unavailable"), damage);
    assert.deepEqual(g.dumpAll(), before, damage);
  }
});

for (const failing of [/INSERT INTO correction_drafts/, /INSERT INTO local_drafts/]) {
  test(`C3 a failing ${failing.source.split(" ").at(-1)} insert rolls the whole correction back`, async () => {
    const f = await open();
    const { refused } = await refusedSubmission(f.repository);
    const before = f.dumpAll();
    f.double.failNext(failing);
    await assert.rejects(f.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: refused.operationId }), /Injected SQLite failure/);
    assert.deepEqual(f.dumpAll(), before);
    await f.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: refused.operationId });
    assert.equal(f.dump("correction_drafts").length, 1, "a retry succeeds");
  });
}

test("C4 items carry the corrected operation, through supersession, until an item carrying it is accepted", async () => {
  const f = await open();
  const { refused } = await refusedSubmission(f.repository);
  const { draft } = await f.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: refused.operationId });
  const pending = async () => (await f.repository.listOutbox("employee-a")).filter((item) => item.taskId === "task-a" && item.status !== "resolved");
  const first = await f.repository.save("employee-a", "task-a", form("corrigé 1"), draft.revision);
  assert.deepEqual((await pending()).map((item) => [item.kind, item.correctionOperationId]), [["sync-draft", refused.operationId]]);
  const second = await f.repository.save("employee-a", "task-a", form("corrigé 2"), first.revision);
  assert.deepEqual((await pending()).map((item) => [item.kind, item.correctionOperationId]), [["sync-draft", refused.operationId]], "the superseding item inherits it");
  const { operation } = await f.repository.requestSubmission("employee-a", "task-a", form("corrigé 2"), second.revision);
  assert.deepEqual((await pending()).map((item) => [item.kind, item.correctionOperationId]), [["submit", refused.operationId]]);
  assert.equal(operation.correctionOperationId, refused.operationId);

  // Another task: once an item carrying the reference is accepted, new items carry none.
  const other = await refusedSubmission(f.repository, "task-b");
  const created = await f.repository.createCorrectionDraft("employee-a", "task-b", { rejectedOperationId: other.refused.operationId });
  const saved = await f.repository.save("employee-a", "task-b", form("corrigé B"), created.draft.revision);
  const [carrying] = (await f.repository.listOutbox("employee-a")).filter((item) => item.taskId === "task-b" && item.status !== "resolved");
  assert.equal(carrying!.correctionOperationId, other.refused.operationId);
  await resolve(f.repository, carrying!, "accepted", undefined, 8_000);
  const next = await f.repository.save("employee-a", "task-b", form("après acceptation"), saved.revision);
  const submitted = await f.repository.requestSubmission("employee-a", "task-b", form("après acceptation"), next.revision);
  const items = (await f.repository.listOutbox("employee-a")).filter((item) => item.taskId === "task-b" && item.status !== "resolved");
  assert.deepEqual(items.map((item) => [item.kind, item.correctionOperationId]), [["submit", null]]);
  assert.equal(submitted.operation.correctionOperationId, null);
});

test("C5 correction rows are insert-only", async () => {
  const f = await open();
  const { refused } = await refusedSubmission(f.repository);
  await f.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: refused.operationId });
  const rows = f.dump("correction_drafts");
  assert.throws(() => f.double.engine.exec("UPDATE correction_drafts SET draft_revision = 9"), /insert-only/);
  assert.deepEqual(f.dump("correction_drafts"), rows);
});

test("C6 a submission the domain validator refuses throws SubmissionValidationError with its issues and writes nothing", async () => {
  const f = await open();
  for (const [taskId, value, code] of [["task-nul", "R\u0000", "nul-character"], ["task-high", "R\uD800", "unpaired-surrogate"], ["task-low", "\uDC00R", "unpaired-surrogate"]] as const) {
    // A save stays permissive: the typed data is kept locally and stays readable.
    const saved = await f.repository.save("employee-a", taskId, form(value));
    assert.deepEqual((await f.repository.read("employee-a", taskId))?.payload, form(value));
    const before = f.dumpAll();
    await assert.rejects(f.repository.requestSubmission("employee-a", taskId, form(value), saved.revision), (error: unknown) => {
      assert.ok(error instanceof SubmissionValidationError);
      assert.ok(error instanceof SubmissionNotAllowedError);
      assert.deepEqual(error.issues, [{ path: "values.header.reportNumber", code }]);
      return true;
    });
    assert.deepEqual(f.dumpAll(), before, taskId);
  }
});

test("C7 the authorization wrapper refuses correction reads and writes while locked; another employee's refusal is never corrected", async () => {
  const f = await open();
  const { refused } = await refusedSubmission(f.repository, "task-a", "INVALID_PAYLOAD", "employee-b");
  const before = f.dumpAll();
  const locked = createAuthorizedDrafts(f.repository, async () => { throw new Error("Protected data locked"); });
  await assert.rejects(locked.createCorrectionDraft("employee-b", "task-a", { rejectedOperationId: refused.operationId }), /locked/);
  await assert.rejects(locked.listCorrectionDrafts("employee-b"), /locked/);
  await assert.rejects(f.repository.createCorrectionDraft("employee-a", "task-a", { rejectedOperationId: refused.operationId }), CorrectionDraftError);
  assert.deepEqual(f.dumpAll(), before);
  assert.deepEqual(await f.repository.listCorrectionDrafts("employee-a"), []);
});
