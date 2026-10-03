import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { SecureKeyValueStore } from "../offline-authorization-state.js";

const keyName = "cetem-qc.local-drafts.database-key.v1";
mock.module("expo-sqlite", { namedExports: { openDatabaseAsync: async () => { throw new Error("unused default driver"); } } });
mock.module("expo-crypto", { namedExports: { getRandomBytesAsync: async (length: number) => new Uint8Array(length) } });

async function fixture(options: { key?: string; existing?: boolean; userVersion?: number; openFailure?: boolean; keyFailure?: boolean; databaseReadFailure?: boolean; migrationFailure?: boolean } = {}) {
  const values = new Map<string, string>();
  if (options.key !== undefined) values.set(keyName, options.key);
  const events: string[] = [];
  const existingRows = new Map([["prior", "preserved encrypted bytes"]]);
  const cachedRows = new Map<string, { task_json: string; synchronized_at: number }>();
  let version = options.userVersion ?? (options.existing ? 2 : 0);
  let generated = 0;
  const statements: Array<{ sql: string; params: unknown[]; inTransaction: boolean }> = [];
  let inTransaction = false;
  const store: SecureKeyValueStore = {
    async get(key) { events.push(`secure-get:${key}`); return values.get(key) ?? null; },
    async set(key, value) { events.push(`secure-set:${key}`); values.set(key, value); },
    async remove(key) { events.push(`secure-remove:${key}`); values.delete(key); },
  };
  const db = {
    async execAsync(sql: string) {
      events.push(sql.trim().startsWith("PRAGMA key") ? "pragma-key" : sql.trim().startsWith("PRAGMA synchronous") ? "pragma-synchronous" : "migration");
      if (sql.trim().startsWith("PRAGMA key") && options.keyFailure) throw new Error("SQLCipher rejected key");
      if (sql.includes("CREATE TABLE") && options.migrationFailure) throw new Error("migration failed");
      if (/\bDROP\s+TABLE\b|\bDELETE\s+FROM\s+local_drafts\b/i.test(sql)) existingRows.clear();
      const match = sql.match(/PRAGMA user_version = (\d+)/);
      if (match) version = Number(match[1]);
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      statements.push({ sql, params, inTransaction });
      events.push(sql.includes("user_version") ? "read-user-version" : "read-schema");
      if (sql.includes("user_version") && options.databaseReadFailure) throw new Error("file is not a database");
      if (sql.includes("user_version")) return { user_version: version } as T;
      if (sql.includes("synchronized_tasks")) return options.existing ? { name: "synchronized_tasks" } as T : null;
      return options.existing ? { name: "local_drafts" } as T : null;
    },
    async getAllAsync<T>(sql: string, employeeId: string): Promise<T[]> {
      statements.push({ sql, params: [employeeId], inTransaction });
      events.push("read-data");
      if (sql.includes("synchronized_tasks")) return [...cachedRows.entries()].filter(([key]) => key.startsWith(`${employeeId}/`)).map(([, row]) => row as T);
      return [...existingRows.values()].map((payload_json) => ({ payload_json }) as T);
    },
    async runAsync(sql: string, ...params: (string | number)[]) {
      statements.push({ sql, params, inTransaction });
      events.push("write-data");
      if (/^\s*DELETE\s+FROM\s+local_drafts\b/i.test(sql)) existingRows.clear();
      if (sql.includes("DELETE FROM synchronized_tasks")) {
        const [employeeId, taskId] = params;
        for (const key of cachedRows.keys()) {
          if (key.startsWith(`${employeeId}/`) && (taskId === undefined || key === `${employeeId}/${taskId}`)) cachedRows.delete(key);
        }
      }
      if (sql.includes("INSERT INTO synchronized_tasks")) {
        const [employeeId, taskId, task_json, synchronized_at] = params;
        cachedRows.set(`${employeeId}/${taskId}`, { task_json: String(task_json), synchronized_at: Number(synchronized_at) });
      }
      return { changes: 1, lastInsertRowId: 1 };
    },
    async withExclusiveTransactionAsync(operation: (tx: typeof db) => Promise<void>) {
      events.push("begin-transaction");
      const before = version;
      const draftsBefore = new Map(existingRows);
      const cacheBefore = new Map(cachedRows);
      inTransaction = true;
      try { await operation(db); events.push("commit-transaction"); }
      catch (error) {
        version = before;
        existingRows.clear(); for (const [key, value] of draftsBefore) existingRows.set(key, value);
        cachedRows.clear(); for (const [key, value] of cacheBefore) cachedRows.set(key, value);
        events.push("rollback-transaction"); throw error;
      } finally { inTransaction = false; }
    },
    async closeAsync() { events.push("close"); },
  };
  const driver = {
    async openDatabaseAsync() {
      events.push("open-database");
      if (options.openFailure) throw new Error("database open failed");
      return db;
    },
  };
  const { createSqliteDraftDatabase } = await import("./sqlite-draft-database.js");
  const database = createSqliteDraftDatabase(store, driver, async (length) => {
    generated++;
    return new Uint8Array(length).fill(0xab);
  });
  return { database, values, events, existingRows, cachedRows, statements, generated: () => generated };
}

test("retrieves an existing SecureStore key and configures SQLCipher before schema access", async () => {
  const f = await fixture({ key: "a".repeat(64), existing: true });
  await f.database.read("employee", "task");
  assert.equal(f.generated(), 0);
  assert.ok(f.events.indexOf("secure-get:cetem-qc.local-drafts.database-key.v1") < f.events.indexOf("open-database"));
  assert.ok(f.events.indexOf("open-database") < f.events.indexOf("pragma-key"));
  assert.ok(f.events.indexOf("pragma-key") < f.events.indexOf("pragma-synchronous"));
  assert.ok(f.events.indexOf("pragma-synchronous") < f.events.indexOf("read-user-version"));
});

test("generates and stores a 256-bit key only when SecureStore has no key", async () => {
  const f = await fixture();
  await f.database.read("employee", "task");
  assert.equal(f.generated(), 1);
  assert.equal(f.values.get(keyName), "ab".repeat(32));
});

test("database-open failure propagates without removing a pre-existing key or existing work", async () => {
  const f = await fixture({ key: "b".repeat(64), existing: true, openFailure: true });
  await assert.rejects(f.database.read("employee", "task"), /database open failed/);
  assert.equal(f.values.get(keyName), "b".repeat(64));
  assert.equal(f.existingRows.get("prior"), "preserved encrypted bytes");
  assert.ok(!f.events.includes("pragma-key"));
});

test("an existing encrypted database with a missing key fails closed and does not retain a replacement key", async () => {
  const f = await fixture({ existing: true, databaseReadFailure: true });
  await assert.rejects(f.database.read("employee", "task"), /file is not a database/);
  assert.equal(f.generated(), 1);
  assert.equal(f.values.has(keyName), false);
  assert.equal(f.existingRows.get("prior"), "preserved encrypted bytes");
  assert.ok(f.events.includes("pragma-key"), "the generated key is applied before encrypted database access");
  assert.ok(f.events.includes("read-user-version"), "wrong-key detection occurs at the first protected database read");
  assert.ok(!f.events.includes("read-schema"));
});

test("wrong stored key and DB-open errors do not fall back to plaintext or replace the key", async () => {
  const wrong = await fixture({ key: "c".repeat(64), existing: true, databaseReadFailure: true });
  await assert.rejects(wrong.database.list("employee"), /file is not a database/);
  assert.equal(wrong.values.get(keyName), "c".repeat(64), "the adapter does not replace a stored key after read failure");
  assert.ok(wrong.events.includes("pragma-key"));
  assert.ok(!wrong.events.includes("read-data"));
  const invalid = await fixture({ key: "not-a-key", existing: true });
  await assert.rejects(invalid.database.read("employee", "task"), /encryption key is invalid/);
  assert.ok(!invalid.events.includes("open-database"));
  const open = await fixture({ key: "d".repeat(64), existing: true, openFailure: true });
  await assert.rejects(open.database.read("employee", "task"), /database open failed/);
  assert.ok(!open.events.includes("read-data"));
});

test("migration failure rolls back initialization, propagates, and preserves existing bytes and key", async () => {
  const f = await fixture({ key: "d".repeat(64), existing: true, userVersion: 0, migrationFailure: true });
  await assert.rejects(f.database.read("employee", "task"), /migration failed/);
  assert.equal(f.values.get(keyName), "d".repeat(64));
  assert.equal(f.existingRows.get("prior"), "preserved encrypted bytes");
  assert.ok(f.events.includes("rollback-transaction"));
  assert.ok(!f.events.includes("read-data"));
});

test("version 1 migration adds the synchronized-task cache without rewriting existing draft data", async () => {
  const f = await fixture({ key: "e".repeat(64), existing: true, userVersion: 1 });
  await f.database.read("employee", "task");
  assert.equal(f.existingRows.get("prior"), "preserved encrypted bytes");
  assert.ok(f.events.includes("begin-transaction"));
  assert.ok(f.events.includes("commit-transaction"));
  assert.ok(f.events.includes("migration"), "the v2 cache table is added transactionally");
  assert.ok(!f.events.some((event) => event.includes("DROP TABLE") || event.includes("DELETE FROM local_drafts")));
});

test("authoritative cache replacement is employee-scoped and task revocation preserves draft rows", async () => {
  const f = await fixture({ key: "f".repeat(64), existing: true });
  const task = (id: string) => ({ id, establishment: `Centre ${id}`, service: "Radiologie", createdAt: "2026-10-01T00:00:00.000Z" });
  await f.database.cacheSynchronizedTask({ employeeId: "employee-a", task: task("task-a"), synchronizedAt: 10 });
  await f.database.cacheSynchronizedTask({ employeeId: "employee-b", task: task("task-b"), synchronizedAt: 11 });
  await f.database.replaceCachedSynchronizedTasks("employee-a", [{ employeeId: "employee-a", task: task("task-c"), synchronizedAt: 12 }]);
  assert.deepEqual([...f.cachedRows.keys()], ["employee-b/task-b", "employee-a/task-c"]);
  await f.database.revokeCachedSynchronizedTask("employee-a", "task-c");
  assert.deepEqual([...f.cachedRows.keys()], ["employee-b/task-b"]);
  assert.equal(f.existingRows.get("prior"), "preserved encrypted bytes");
});

test("M4 unreadable-draft deletion is one employee/task-scoped DELETE in an exclusive transaction with no prior read", async () => {
  const f = await fixture({ key: "a".repeat(64), existing: true });
  await f.database.read("employee-a", "task-a");
  const before = f.statements.length;
  await f.database.deleteUnreadable("employee-a", "task-a");
  const issued = f.statements.slice(before);
  assert.deepEqual(issued.map(({ sql, params, inTransaction }) => ({ sql: sql.replace(/\s+/g, " ").trim(), params, inTransaction })), [
    { sql: "DELETE FROM local_drafts WHERE employee_id = ? AND task_id = ?", params: ["employee-a", "task-a"], inTransaction: true },
  ]);
  assert.ok(!issued.some(({ sql }) => /SELECT/i.test(sql)), "the unreadable row is never read or parsed");
  assert.ok(!f.cachedRows.size, "synchronized task cache is not touched");
});
