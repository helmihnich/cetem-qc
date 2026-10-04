import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import type { SecureKeyValueStore } from "../offline-authorization-state";
import { OutboxOperationNotFoundError, PendingSubmissionError, type CachedSynchronizedTask, type DraftDatabase, type LocalDraft, type NewOutboxOperation, type OutboxItem } from "./model";
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
    async save(record: LocalDraft, expectedRevision?: number, operation?: NewOutboxOperation) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          await assertNoPendingSubmission(tx, record.employeeId, record.taskId);
          await writeDraft(tx, record, expectedRevision);
          if (operation) {
            await removeUnresolvedSyncDrafts(tx, record.employeeId, record.taskId, true);
            await insertOperation(tx, operation);
          }
        });
      });
    },
    async requestSubmission(record, expectedRevision, operation) {
      return serialize(async () => {
        const db = await open();
        let item: OutboxItem | undefined;
        await db.withExclusiveTransactionAsync(async (tx) => {
          const { employeeId, taskId, revision } = operation.snapshot;
          await assertNoPendingSubmission(tx, employeeId, taskId);
          if (record) await writeDraft(tx, record, expectedRevision);
          else {
            const stored = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
            if (stored?.revision !== revision) throw new Error("Local draft revision changed.");
          }
          await removeUnresolvedSyncDrafts(tx, employeeId, taskId, true);
          item = await insertOperation(tx, operation);
        });
        return item!;
      });
    },
    async delete(employeeId, taskId, expectedRevision) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          await assertNoPendingSubmission(tx, employeeId, taskId);
          const result = await tx.runAsync("DELETE FROM local_drafts WHERE employee_id = ? AND task_id = ? AND revision = ?", employeeId, taskId, expectedRevision);
          if (result.changes !== 1) throw new Error("Local draft revision changed before deletion.");
          await removeUnresolvedSyncDrafts(tx, employeeId, taskId, false);
        });
      });
    },
    async deleteUnreadable(employeeId, taskId) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          await assertNoPendingSubmission(tx, employeeId, taskId);
          // No read, parse or revision check: the row is unreadable by this app version. Zero rows means already gone.
          await tx.runAsync("DELETE FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
          await removeUnresolvedSyncDrafts(tx, employeeId, taskId, false);
        });
      });
    },
    async listOutbox(employeeId, taskId) {
      return serialize(async () => {
        const db = await open();
        const rows = taskId === undefined
          ? await db.getAllAsync<OutboxRow>(`SELECT ${OUTBOX_COLUMNS} FROM outbox_operations WHERE employee_id = ? ORDER BY sequence`, employeeId)
          : await db.getAllAsync<OutboxRow>(`SELECT ${OUTBOX_COLUMNS} FROM outbox_operations WHERE employee_id = ? AND task_id = ? ORDER BY sequence`, employeeId, taskId);
        return rows.map(toOutboxItem);
      });
    },
    async readOutboxSnapshot(employeeId, operationId) {
      return serialize(async () => {
        const db = await open();
        const row = await db.getFirstAsync<{ payload_json: string }>(`SELECT audit_snapshots.payload_json FROM outbox_operations
          JOIN audit_snapshots ON audit_snapshots.snapshot_id = outbox_operations.snapshot_id
          WHERE outbox_operations.employee_id = ? AND outbox_operations.operation_id = ? AND audit_snapshots.employee_id = outbox_operations.employee_id
          AND audit_snapshots.task_id = outbox_operations.task_id`,
        employeeId, operationId);
        return row?.payload_json ?? null;
      });
    },
    async recordOutboxTransition(employeeId, operationId, transition) {
      return serialize(async () => {
        const db = await open();
        let item: OutboxItem | undefined;
        await db.withExclusiveTransactionAsync(async (tx) => {
          const current = await readOperation(tx, employeeId, operationId);
          if (!current || current.status === "resolved") throw new OutboxOperationNotFoundError();
          const { at } = transition;
          if (transition.type === "attempt-start") {
            await tx.runAsync("UPDATE outbox_operations SET status = 'in-flight', attempt_count = attempt_count + 1, updated_at = ? WHERE operation_id = ?", at, operationId);
          } else if (transition.type === "retryable" || transition.type === "blocking") {
            const status = transition.type === "blocking" ? "blocked" : transition.pause ? "retry-paused" : "queued";
            await tx.runAsync("UPDATE outbox_operations SET status = ?, last_error = ?, updated_at = ? WHERE operation_id = ?", status, transition.code, at, operationId);
          } else {
            if (transition.outcome === "accepted" && (!Number.isSafeInteger(transition.serverRevision) || transition.serverRevision! < 0)) {
              throw new Error("Accepted outcome needs a server revision.");
            }
            const metadata = JSON.stringify({ serverRevision: transition.serverRevision, detail: transition.detail });
            await tx.runAsync(`UPDATE outbox_operations SET status = 'resolved', outcome = ?, outcome_json = ?, resolved_at = ?, updated_at = ?
              WHERE operation_id = ?`, transition.outcome, metadata, at, at, operationId);
            if (transition.outcome === "accepted") {
              await tx.runAsync(`INSERT INTO task_sync_state (employee_id, task_id, server_revision, updated_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(employee_id, task_id) DO UPDATE SET server_revision = excluded.server_revision, updated_at = excluded.updated_at`,
              employeeId, current.taskId, transition.serverRevision!, at);
              // Later items built on the same server revision are the device's own changes: they move to the new revision.
              await tx.runAsync(`UPDATE outbox_operations SET base_revision = ?, updated_at = ?
                WHERE employee_id = ? AND task_id = ? AND status <> 'resolved' AND sequence > ? AND base_revision = ?`,
              transition.serverRevision!, at, employeeId, current.taskId, current.sequence, current.baseRevision);
            }
          }
          item = await readOperation(tx, employeeId, operationId) ?? undefined;
        });
        return item!;
      });
    },
  };
}

type SqlTransaction = Pick<SqlDatabase, "getFirstAsync" | "getAllAsync" | "runAsync">;
type OutboxRow = {
  operation_id: string; idempotency_key: string; employee_id: string; task_id: string; sequence: number;
  kind: OutboxItem["kind"]; snapshot_id: string; base_revision: number; status: OutboxItem["status"];
  attempt_count: number; last_error: string | null; outcome: OutboxItem["outcome"]; outcome_json: string | null;
  created_at: number; updated_at: number; resolved_at: number | null;
};
const OUTBOX_COLUMNS = `operation_id, idempotency_key, employee_id, task_id, sequence, kind, snapshot_id, base_revision,
  status, attempt_count, last_error, outcome, outcome_json, created_at, updated_at, resolved_at`;

function toOutboxItem(row: OutboxRow): OutboxItem {
  return {
    operationId: row.operation_id, idempotencyKey: row.idempotency_key, employeeId: row.employee_id, taskId: row.task_id,
    sequence: row.sequence, kind: row.kind, snapshotId: row.snapshot_id, baseRevision: row.base_revision, status: row.status,
    attemptCount: row.attempt_count, lastError: row.last_error, outcome: row.outcome,
    outcomeMetadata: row.outcome_json === null ? null : JSON.parse(row.outcome_json),
    createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at,
  };
}

async function readOperation(tx: SqlTransaction, employeeId: string, operationId: string): Promise<OutboxItem | null> {
  const row = await tx.getFirstAsync<OutboxRow>(`SELECT ${OUTBOX_COLUMNS} FROM outbox_operations WHERE employee_id = ? AND operation_id = ?`, employeeId, operationId);
  return row ? toOutboxItem(row) : null;
}

async function assertNoPendingSubmission(tx: SqlTransaction, employeeId: string, taskId: string) {
  const pending = await tx.getFirstAsync<{ operation_id: string }>(`SELECT operation_id FROM outbox_operations
    WHERE employee_id = ? AND task_id = ? AND kind = 'submit' AND status <> 'resolved' LIMIT 1`, employeeId, taskId);
  if (pending) throw new PendingSubmissionError();
}

async function writeDraft(tx: SqlTransaction, record: LocalDraft, expectedRevision: number | undefined) {
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
}

/** Removes unresolved `sync-draft` items and their snapshots (never-attempted ones only on supersession). */
async function removeUnresolvedSyncDrafts(tx: SqlTransaction, employeeId: string, taskId: string, neverAttemptedOnly: boolean) {
  const rows = await tx.getAllAsync<{ operation_id: string; snapshot_id: string }>(`SELECT operation_id, snapshot_id FROM outbox_operations
    WHERE employee_id = ? AND task_id = ? AND kind = 'sync-draft' AND status <> 'resolved'${neverAttemptedOnly ? " AND attempt_count = 0" : ""}`,
  employeeId, taskId);
  for (const row of rows) {
    await tx.runAsync("DELETE FROM outbox_operations WHERE operation_id = ? AND employee_id = ?", row.operation_id, employeeId);
    await tx.runAsync("DELETE FROM audit_snapshots WHERE snapshot_id = ? AND employee_id = ?", row.snapshot_id, employeeId);
  }
}

async function insertOperation(tx: SqlTransaction, operation: NewOutboxOperation): Promise<OutboxItem> {
  const { employeeId, taskId } = operation.snapshot;
  const state = await tx.getFirstAsync<{ server_revision: number }>("SELECT server_revision FROM task_sync_state WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
  const next = await tx.getFirstAsync<{ next_sequence: number }>("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM outbox_operations");
  await tx.runAsync(`INSERT INTO audit_snapshots (snapshot_id, employee_id, task_id, kind, draft_revision, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  operation.snapshotId, employeeId, taskId, operation.kind, operation.snapshot.revision, JSON.stringify(operation.snapshot), operation.createdAt);
  await tx.runAsync(`INSERT INTO outbox_operations (operation_id, idempotency_key, employee_id, task_id, sequence, kind, snapshot_id,
    base_revision, status, attempt_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
  operation.operationId, operation.idempotencyKey, employeeId, taskId, next?.next_sequence ?? 1, operation.kind, operation.snapshotId,
  state?.server_revision ?? 0, operation.createdAt, operation.createdAt);
  const item = await readOperation(tx, employeeId, operation.operationId);
  if (!item) throw new Error("Outbox operation was not committed.");
  return item;
}
