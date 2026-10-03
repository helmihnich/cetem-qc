import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import type { SecureKeyValueStore } from "../offline-authorization-state";
import type { CachedSynchronizedTask, DraftDatabase, LocalDraft } from "./model";
import { initializeDraftDatabase } from "./sqlite-draft-schema";

const DATABASE_NAME = "cetem-qc-local-drafts.db";
const DATABASE_KEY = "cetem-qc.local-drafts.database-key.v1";

type SqlDatabase = Pick<SQLite.SQLiteDatabase,
  "execAsync" | "getFirstAsync" | "getAllAsync" | "runAsync" | "withExclusiveTransactionAsync" | "closeAsync">;
type SqliteDriver = { openDatabaseAsync(name: string): Promise<SqlDatabase> };

export function createSqliteDraftDatabase(
  secureStore: SecureKeyValueStore,
  driver: SqliteDriver = SQLite,
  randomBytes: (length: number) => Promise<Uint8Array> = Crypto.getRandomBytesAsync,
): DraftDatabase {
  let connection: Promise<SqlDatabase> | undefined;
  let serial: Promise<void> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const result = serial.then(work, work);
    serial = result.then(() => undefined, () => undefined);
    return result;
  };
  const open = async () => {
    if (!connection) {
      connection = (async () => {
        let key: string | null = null;
        let createdKey = false;
        let db: SqlDatabase | undefined;
        try {
          key = await secureStore.get(DATABASE_KEY);
          createdKey = key === null;
          if (createdKey) {
            const bytes = await randomBytes(32);
            key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
            await secureStore.set(DATABASE_KEY, key);
          }
          if (key === null || !/^[0-9a-f]{64}$/.test(key)) throw new Error("Local draft encryption key is invalid.");
          db = await driver.openDatabaseAsync(DATABASE_NAME);
          await db.execAsync(`PRAGMA key = '${key}'`);
          await db.execAsync("PRAGMA synchronous = FULL");
          await initializeDraftDatabase(db);
          return db;
        } catch (error) {
          await db?.closeAsync().catch(() => undefined);
          connection = undefined;
          if (createdKey && key) await secureStore.remove(DATABASE_KEY).catch(() => undefined);
          throw error;
        }
      })();
    }
    return connection;
  };
  return {
    async read(employeeId, taskId) {
      return serialize(async () => {
        const db = await open();
        const row = await db.getFirstAsync<{ payload_json: string }>("SELECT payload_json FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
        return row?.payload_json ?? null;
      });
    },
    async list(employeeId) {
      return serialize(async () => {
        const db = await open();
        const rows = await db.getAllAsync<{ payload_json: string }>("SELECT payload_json FROM local_drafts WHERE employee_id = ? ORDER BY saved_at DESC", employeeId);
        return rows.map((row) => row.payload_json);
      });
    },
    async cacheSynchronizedTask(record: CachedSynchronizedTask) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          await tx.runAsync(`INSERT INTO synchronized_tasks (employee_id, task_id, task_json, synchronized_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(employee_id, task_id) DO UPDATE SET
            task_json = excluded.task_json, synchronized_at = excluded.synchronized_at`,
          record.employeeId, record.task.id, JSON.stringify(record.task), record.synchronizedAt);
        });
      });
    },
    async replaceCachedSynchronizedTasks(employeeId, records) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          await tx.runAsync("DELETE FROM synchronized_tasks WHERE employee_id = ?", employeeId);
          for (const record of records) {
            if (record.employeeId !== employeeId) throw new Error("Cached task scope mismatch.");
            await tx.runAsync(`INSERT INTO synchronized_tasks (employee_id, task_id, task_json, synchronized_at)
              VALUES (?, ?, ?, ?)`, record.employeeId, record.task.id, JSON.stringify(record.task), record.synchronizedAt);
          }
        });
      });
    },
    async revokeCachedSynchronizedTask(employeeId, taskId) {
      return serialize(async () => {
        const db = await open();
        await db.runAsync("DELETE FROM synchronized_tasks WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
      });
    },
    async listCachedSynchronizedTasks(employeeId) {
      return serialize(async () => {
        const db = await open();
        const rows = await db.getAllAsync<{ task_json: string; synchronized_at: number }>(
          "SELECT task_json, synchronized_at FROM synchronized_tasks WHERE employee_id = ? ORDER BY synchronized_at DESC", employeeId);
        return rows.map((row) => JSON.stringify({ employeeId, task: JSON.parse(row.task_json), synchronizedAt: row.synchronized_at }));
      });
    },
    async save(record: LocalDraft, expectedRevision?: number) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          const previous = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM local_drafts WHERE employee_id = ? AND task_id = ?", record.employeeId, record.taskId);
          if ((previous?.revision ?? undefined) !== expectedRevision) throw new Error("Local draft revision changed.");
          await tx.runAsync(`INSERT INTO local_drafts
            (employee_id, task_id, draft_id, payload_schema_version, revision, created_at, saved_at, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(employee_id, task_id) DO UPDATE SET
              payload_schema_version = excluded.payload_schema_version,
              revision = excluded.revision,
              saved_at = excluded.saved_at,
              payload_json = excluded.payload_json
            WHERE local_drafts.revision = ?`,
          record.employeeId, record.taskId, record.id, record.payloadSchemaVersion, record.revision,
          record.createdAt, record.savedAt, JSON.stringify(record), expectedRevision ?? 0);
          const committed = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM local_drafts WHERE employee_id = ? AND task_id = ?", record.employeeId, record.taskId);
          if (committed?.revision !== record.revision) throw new Error("Local draft revision was not committed.");
        });
      });
    },
    async delete(employeeId, taskId, expectedRevision) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          const result = await tx.runAsync("DELETE FROM local_drafts WHERE employee_id = ? AND task_id = ? AND revision = ?", employeeId, taskId, expectedRevision);
          if (result.changes !== 1) throw new Error("Local draft revision changed before deletion.");
        });
      });
    },
    async deleteUnreadable(employeeId, taskId) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          // No read, parse or revision check: the row is unreadable by this app version. Zero rows means already gone.
          await tx.runAsync("DELETE FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
        });
      });
    },
  };
}
