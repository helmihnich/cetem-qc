import assert from "node:assert/strict";
import test from "node:test";
import { createAuthorizedDrafts } from "./authorized-drafts.js";
import { createDraftRepository, DraftListCorruptionError, LocalDraftPayloadCompatibilityError, type DraftDatabase, type LocalDraft } from "./model.js";
import { initializeDraftDatabase } from "./sqlite-draft-schema.js";
import { createOfflineAuthorizationService } from "../offline-authorization-state.js";

function fixture() {
  const records = new Map<string, string>();
  let failSave = false;
  let failDelete = false;
  const key = (employeeId: string, taskId: string) => `${employeeId}/${taskId}`;
  const database: DraftDatabase = {
    async read(employeeId, taskId) { return records.get(key(employeeId, taskId)) ?? null; },
    async list(employeeId) { return [...records.values()].filter((raw) => (JSON.parse(raw) as LocalDraft).employeeId === employeeId); },
    async save(record, expectedRevision) {
      const previousRaw = records.get(key(record.employeeId, record.taskId));
      const previous = previousRaw ? JSON.parse(previousRaw) as LocalDraft : undefined;
      if ((previous?.revision ?? undefined) !== expectedRevision) throw new Error("stale revision");
      if (failSave) throw new Error("storage failure");
      records.set(key(record.employeeId, record.taskId), JSON.stringify(record));
    },
    async delete(employeeId, taskId, revision) {
      const raw = records.get(key(employeeId, taskId));
      if (!raw || (JSON.parse(raw) as LocalDraft).revision !== revision) throw new Error("stale delete");
      if (failDelete) throw new Error("delete failure");
      records.delete(key(employeeId, taskId));
    },
    async deleteUnreadable(employeeId, taskId) {
      if (failDelete) throw new Error("delete failure");
      records.delete(key(employeeId, taskId));
    },
    async cacheSynchronizedTask(record) { records.set(`cache/${record.employeeId}/${record.task.id}`, JSON.stringify(record)); },
    async replaceCachedSynchronizedTasks(employeeId, replacements) {
      for (const key of records.keys()) if (key.startsWith(`cache/${employeeId}/`)) records.delete(key);
      for (const record of replacements) records.set(`cache/${employeeId}/${record.task.id}`, JSON.stringify(record));
    },
    async revokeCachedSynchronizedTask(employeeId, taskId) { records.delete(`cache/${employeeId}/${taskId}`); },
    async listCachedSynchronizedTasks(employeeId) { return [...records.entries()].filter(([id]) => id.startsWith(`cache/${employeeId}/`)).map(([, raw]) => raw); },
    // Outbox behaviour is covered against the SQLite double in outbox.test.ts; this fake has no outbox items.
    async requestSubmission() { throw new Error("outbox not supported by this fake"); },
    async listOutbox() { return []; },
    async readOutboxSnapshot() { return null; },
    async recordOutboxTransition() { throw new Error("outbox not supported by this fake"); },
  };
  let time = 100;
  let id = 0;
  const repository = () => createDraftRepository(database, () => ++time, () => `draft-${++id}`);
  return { records, database, repository, setFailSave: (value: boolean) => { failSave = value; }, setFailDelete: (value: boolean) => { failDelete = value; } };
}

test("creates, explicitly saves, revises and resumes latest committed draft after repository remount", async () => {
  const f = fixture();
  const drafts = f.repository();
  const created = await drafts.save("employee-a", "task-a", "opaque first content");
  assert.equal(created.revision, 1);
  const saved = await drafts.save("employee-a", "task-a", "edited content", created.revision);
  assert.equal(saved.revision, 2);
  const remounted = f.repository();
  assert.deepEqual(await remounted.read("employee-a", "task-a"), saved);
  assert.equal((await remounted.list("employee-a")).length, 1);
});

test("stores synchronized task availability with account isolation and durable repository remount", async () => {
  const f = fixture();
  const task = { id: "task-a", establishment: "Centre A", service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" };
  await f.repository().cacheSynchronizedTask("employee-a", task);
  assert.deepEqual((await f.repository().listCachedSynchronizedTasks("employee-a")).map((entry) => entry.task), [task]);
  assert.deepEqual(await f.repository().listCachedSynchronizedTasks("employee-b"), []);
});

test("authoritative cached-task replacement revokes omitted context without touching draft evidence", async () => {
  const f = fixture();
  const drafts = f.repository();
  const taskA = { id: "task-a", establishment: "Centre A", service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" };
  const taskB = { id: "task-b", establishment: "Centre B", service: "Urgences", createdAt: "2026-10-02T00:00:00.000Z" };
  await drafts.cacheSynchronizedTask("employee-a", taskA);
  await drafts.cacheSynchronizedTask("employee-b", taskB);
  const preserved = await drafts.save("employee-a", "task-a", "protected evidence");
  await drafts.replaceCachedSynchronizedTasks("employee-a", []);
  assert.deepEqual(await drafts.listCachedSynchronizedTasks("employee-a"), []);
  assert.deepEqual(await drafts.listCachedSynchronizedTasks("employee-b").then((entries) => entries.map((entry) => entry.task)), [taskB]);
  assert.deepEqual(await drafts.read("employee-a", "task-a"), preserved, "removing task-context eligibility preserves the encrypted local draft");
});

test("cached-task removal is scoped to context and never deletes the associated draft", async () => {
  const f = fixture();
  const drafts = f.repository();
  const task = { id: "task-a", establishment: "Centre A", service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" };
  await drafts.cacheSynchronizedTask("employee-a", task);
  await drafts.cacheSynchronizedTask("employee-b", { ...task, id: "task-a" });
  const saved = await drafts.save("employee-a", task.id, "preserved local data");
  await drafts.revokeCachedSynchronizedTask("employee-a", task.id);
  assert.deepEqual(await drafts.listCachedSynchronizedTasks("employee-a"), []);
  assert.equal((await drafts.listCachedSynchronizedTasks("employee-b")).length, 1);
  assert.deepEqual(await drafts.read("employee-a", task.id), saved);
});

test("preserves Story 5.3 opaque content and persists versioned form payloads without resetting the draft", async () => {
  const f = fixture();
  const drafts = f.repository();
  const legacy = await drafts.save("employee-a", "task-a", "opaque first content");
  const form = { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0", values: { "controlPerformedBy.dateControle": "2026-10-01T00:00:00.000000001Z", "voltage.repeatability.row2.kvMeasured": "69,7" } };
  const revised = await drafts.save("employee-a", "task-a", form, legacy.revision);
  assert.equal(revised.revision, legacy.revision + 1);
  assert.deepEqual((await f.repository().read("employee-a", "task-a"))?.payload, form);
});

test("unsupported calculation tuple cannot hydrate or rewrite retained draft bytes", async () => {
  const f = fixture();
  const original = JSON.stringify({
    id: "draft-old", employeeId: "employee-a", taskId: "task-a", payloadSchemaVersion: 1,
    revision: 1, createdAt: 100, savedAt: 100,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "future-rule", ruleVersion: "3.0", values: { "voltage.accuracy.row1.kvMeasured": "49.20000000000001" } },
  });
  f.records.set("employee-a/task-a", original);
  await assert.rejects(f.repository().read("employee-a", "task-a"));
  assert.equal(f.records.get("employee-a/task-a"), original);
});

test("a stored catalogue 1.0.0 / schema 2 draft is incompatible and its stored bytes stay unchanged", async () => {
  const f = fixture();
  const original = JSON.stringify({
    id: "draft-v1", employeeId: "employee-a", taskId: "task-a", payloadSchemaVersion: 1,
    revision: 3, createdAt: 100, savedAt: 120,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "intervention.contexte": "v1 work", "voltage.accuracy": "49.2" } },
  });
  f.records.set("employee-a/task-a", original);
  await assert.rejects(f.repository().read("employee-a", "task-a"), LocalDraftPayloadCompatibilityError);
  assert.equal(f.records.get("employee-a/task-a"), original);
});

test("enforces one draft per employee/task and isolates employees and tasks", async () => {
  const drafts = fixture().repository();
  const a = await drafts.save("employee-a", "task-a", "A");
  const revised = await drafts.save("employee-a", "task-a", "A2", a.revision);
  await drafts.save("employee-a", "task-b", "B");
  await drafts.save("employee-b", "task-a", "other employee");
  assert.equal((await drafts.list("employee-a")).length, 2);
  assert.equal((await drafts.read("employee-a", "task-a"))?.id, revised.id);
  assert.equal((await drafts.read("employee-b", "task-b")), null);
});

test("failed save preserves previous commit and failed deletion preserves draft", async () => {
  const f = fixture();
  const drafts = f.repository();
  const saved = await drafts.save("employee-a", "task-a", "last durable version");
  f.setFailSave(true);
  await assert.rejects(drafts.save("employee-a", "task-a", "newer unsaved edit", saved.revision));
  f.setFailSave(false);
  assert.deepEqual(await drafts.read("employee-a", "task-a"), saved);
  f.setFailDelete(true);
  await assert.rejects(drafts.delete("employee-a", "task-a", saved.revision));
  assert.deepEqual(await drafts.read("employee-a", "task-a"), saved);
});

test("a failed first write is not returned or exposed as a resumable draft", async () => {
  const f = fixture();
  const drafts = f.repository();
  f.setFailSave(true);
  await assert.rejects(drafts.save("employee-a", "task-a", "not committed"));
  f.setFailSave(false);
  assert.equal(await drafts.read("employee-a", "task-a"), null);
  assert.deepEqual(await drafts.list("employee-a"), []);
});

test("an explicitly deleted task can start a fresh local draft with a new identity", async () => {
  const drafts = fixture().repository();
  const original = await drafts.save("employee-a", "task-a", "first draft");
  await drafts.delete("employee-a", "task-a", original.revision);
  const replacement = await drafts.save("employee-a", "task-a", "new local draft", 0);
  assert.equal(replacement.revision, 1);
  assert.notEqual(replacement.id, original.id);
});

test("serial revision guard rejects stale async writers without replacing newer work", async () => {
  const f = fixture();
  const drafts = f.repository();
  const initial = await drafts.save("employee-a", "task-a", "initial");
  const outcomes = await Promise.allSettled([
    drafts.save("employee-a", "task-a", "first", initial.revision),
    drafts.save("employee-a", "task-a", "stale second", initial.revision),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((await drafts.read("employee-a", "task-a"))?.revision, 2);
});

test("authorization lock denies read/write/delete while preserving protected record; authorized state restores access", async () => {
  const f = fixture();
  const repository = f.repository();
  const saved = await repository.save("employee-a", "task-a", "protected payload");
  let status: "offline-authorized" | "locked-expired" | "locked-logged-out" | "locked-deactivated" = "offline-authorized";
  const authorized = createAuthorizedDrafts(repository, async (id, operation) => {
    if (status !== "offline-authorized" || id !== "employee-a") throw new Error("Protected data locked");
    return operation();
  });
  for (const locked of ["locked-expired", "locked-logged-out", "locked-deactivated"] as const) {
    status = locked;
    await assert.rejects(authorized.read("employee-a", "task-a"));
    await assert.rejects(authorized.save("employee-a", "task-a", "blocked", saved.revision));
    await assert.rejects(authorized.delete("employee-a", "task-a", saved.revision));
    assert.ok(f.records.has("employee-a/task-a"));
  }
  status = "offline-authorized";
  assert.equal((await authorized.read("employee-a", "task-a"))?.payload.content, "protected payload");
});

test("authorization lock serializes behind an already authorized delete and blocks later access", async () => {
  const values = new Map<string, string>();
  const store = {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string) { values.set(key, value); },
    async remove(key: string) { values.delete(key); },
  };
  const identity = { id: "employee-a", email: "a@test", displayName: "A", role: "employe" as const, mustChangePassword: false };
  const authorization = createOfflineAuthorizationService(store, { now: () => 1000 });
  await authorization.establishOnlineAuthorization(identity);
  const base = fixture();
  const repository = base.repository();
  const saved = await repository.save(identity.id, "task-a", "protected");
  let beginDelete!: () => void;
  let releaseDelete!: () => void;
  const started = new Promise<void>((resolve) => { beginDelete = resolve; });
  const gate = new Promise<void>((resolve) => { releaseDelete = resolve; });
  const gatedRepository = {
    ...repository,
    async delete(employeeId: string, taskId: string, revision: number) {
      beginDelete(); await gate; await repository.delete(employeeId, taskId, revision);
    },
  };
  const authorized = createAuthorizedDrafts(gatedRepository, (id, operation) => authorization.withProtectedAccess(id, operation));
  const deletion = authorized.delete(identity.id, "task-a", saved.revision);
  await started;
  let lockFinished = false;
  const logout = authorization.logout(identity.id).then(() => { lockFinished = true; });
  await Promise.resolve();
  assert.equal(lockFinished, false, "logout waits for the authorized transaction to finish");
  releaseDelete();
  await deletion;
  await logout;
  assert.equal(await repository.read(identity.id, "task-a"), null);
  await assert.rejects(authorized.read(identity.id, "task-a"));
});

test("malformed and unsupported payloads fail closed", async () => {
  const f = fixture();
  f.records.set("employee-a/task-a", JSON.stringify({ payloadSchemaVersion: 99, employeeId: "employee-a", taskId: "task-a" }));
  await assert.rejects(f.repository().read("employee-a", "task-a"));
  assert.ok(f.records.has("employee-a/task-a"), "corrupt bytes remain preserved");
});

test("draft listing distinguishes empty, valid, partial-corrupt, and unavailable storage", async () => {
  const f = fixture();
  const drafts = f.repository();
  assert.deepEqual(await drafts.list("employee-a"), [], "an actual empty result remains an empty list");
  const saved = await drafts.save("employee-a", "task-a", "valid entry");
  assert.deepEqual(await drafts.list("employee-a"), [saved], "all-valid entries are returned normally");

  f.records.set("employee-a/task-b", "{not-json");
  f.database.list = async () => [f.records.get("employee-a/task-a")!, f.records.get("employee-a/task-b")!];
  await assert.rejects(drafts.list("employee-a"), (error: unknown) => {
    assert.ok(error instanceof DraftListCorruptionError);
    assert.deepEqual(error.drafts, [saved], "valid drafts survive alongside a corrupt row");
    return true;
  });
  assert.ok(f.records.has("employee-a/task-b"), "corrupt bytes are not silently deleted");

  f.database.list = async () => { throw new Error("database unavailable"); };
  await assert.rejects(drafts.list("employee-a"), /database unavailable/, "a complete list failure remains an error");
  assert.ok(f.records.has("employee-a/task-a"), "a failed list leaves readable records intact");
});

test("database migration initializes an empty versioned schema and rejects unknown versions without reset", async () => {
  let version = 0;
  const statements: string[] = [];
  let failMigration = false;
  const database = {
    async execAsync(sql: string) { statements.push(sql); const match = sql.match(/PRAGMA user_version = (\d+)/); if (match) version = Number(match[1]); if (failMigration) throw new Error("migration failed"); },
    async getFirstAsync<T>(sql: string): Promise<T | null> {
      if (sql.includes("user_version")) return { user_version: version } as T;
      return { name: "local_drafts" } as T;
    },
    async withExclusiveTransactionAsync(operation: (tx: typeof database) => Promise<void>) {
      const oldVersion = version;
      const oldStatements = [...statements];
      try { await operation(this); } catch (error) { version = oldVersion; statements.splice(0, statements.length, ...oldStatements); throw error; }
    },
  };
  await initializeDraftDatabase(database);
  assert.equal(version, 4);
  assert.match(statements[0] ?? "", /CREATE TABLE local_drafts/);
  version = 0;
  failMigration = true;
  await assert.rejects(initializeDraftDatabase(database));
  assert.equal(version, 0, "failed schema migration rolls back its version change");
  // One statement per schema step of the earlier successful migration (v1, v2, v3 and the Story 8.1 v4).
  assert.equal(statements.length, 4, "failed schema migration leaves prior schema statements intact");
  failMigration = false;
  version = 77;
  await assert.rejects(initializeDraftDatabase(database));
  assert.equal(version, 77);
});

const oldRuleDraft = (employeeId: string, taskId: string) => JSON.stringify({
  id: `draft-${employeeId}-${taskId}`, employeeId, taskId, payloadSchemaVersion: 1,
  revision: 3, createdAt: 100, savedAt: 120,
  payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "voltage.accuracy.row1.kvMeasured": "70" } },
});

test("M1 deleteUnreadable removes only the stored unreadable row for that employee and task", async () => {
  const f = fixture();
  const drafts = f.repository();
  const target = oldRuleDraft("employee-a", "task-a");
  f.records.set("employee-a/task-a", target);
  await assert.rejects(drafts.read("employee-a", "task-a"), LocalDraftPayloadCompatibilityError);
  const otherTask = await drafts.save("employee-a", "task-b", "other task draft");
  const otherEmployee = oldRuleDraft("employee-b", "task-a");
  f.records.set("employee-b/task-a", otherEmployee);
  const task = { id: "task-a", establishment: "Centre A", service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" };
  await drafts.cacheSynchronizedTask("employee-a", task);

  await drafts.deleteUnreadable("employee-a", "task-a");

  assert.equal(f.records.has("employee-a/task-a"), false);
  assert.equal(await drafts.read("employee-a", "task-a"), null);
  assert.deepEqual(await drafts.read("employee-a", "task-b"), otherTask);
  assert.equal(f.records.get("employee-b/task-a"), otherEmployee);
  assert.deepEqual((await drafts.listCachedSynchronizedTasks("employee-a")).map((entry) => entry.task), [task]);
  const fresh = await drafts.save("employee-a", "task-a", "fresh draft");
  assert.equal(fresh.revision, 1, "a fresh draft can start after the unreadable one is gone");
});

test("M2 deleteUnreadable resolves when no row exists", async () => {
  const f = fixture();
  await f.repository().deleteUnreadable("employee-a", "missing-task");
  assert.equal(f.records.size, 0);
});

test("M3 deleteUnreadable is refused while protected access is locked and keeps the row bytes", async () => {
  const f = fixture();
  const original = oldRuleDraft("employee-a", "task-a");
  f.records.set("employee-a/task-a", original);
  let unlocked = false;
  const authorized = createAuthorizedDrafts(f.repository(), async (id, operation) => {
    if (!unlocked || id !== "employee-a") throw new Error("Protected data locked");
    return operation();
  });
  await assert.rejects(authorized.deleteUnreadable("employee-a", "task-a"), /locked/);
  assert.equal(f.records.get("employee-a/task-a"), original);
  f.setFailDelete(true);
  unlocked = true;
  await assert.rejects(authorized.deleteUnreadable("employee-a", "task-a"), /delete failure/);
  assert.equal(f.records.get("employee-a/task-a"), original);
  f.setFailDelete(false);
  await authorized.deleteUnreadable("employee-a", "task-a");
  assert.equal(f.records.has("employee-a/task-a"), false);
});
