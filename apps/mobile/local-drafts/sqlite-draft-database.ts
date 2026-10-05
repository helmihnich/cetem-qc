import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import type { SecureKeyValueStore } from "../offline-authorization-state";
import {
  ConflictResolutionError, CorrectionDraftError, findOpenRefusal, isOpenConflict, LOCAL_DRAFT_SCHEMA_VERSION, OpenConflictError, OutboxOperationNotFoundError,
  parseLocalDraft, PendingSubmissionError,
  type CachedSynchronizedTask, type ConflictResolution, type ConflictResolutionWrite, type CorrectionDraft, type CorrectionDraftWrite, type DraftDatabase,
  type LocalDraft, type NewOutboxOperation, type OutboxItem,
} from "./model";
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
          // While a conflict is open the save stays local: no snapshot and no item with a stale base.
          if (operation && !await hasOpenConflict(tx, record.employeeId, record.taskId)) {
            const inherited = await removeUnresolvedSyncDrafts(tx, record.employeeId, record.taskId, true);
            await insertOperation(tx, operation, inherited);
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
          await assertNoOpenConflict(tx, employeeId, taskId);
          await assertNoPendingSubmission(tx, employeeId, taskId);
          if (record) await writeDraft(tx, record, expectedRevision);
          else {
            const stored = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
            if (stored?.revision !== revision) throw new Error("Local draft revision changed.");
          }
          const inherited = await removeUnresolvedSyncDrafts(tx, employeeId, taskId, true);
          item = await insertOperation(tx, operation, inherited);
        });
        return item!;
      });
    },
    async delete(employeeId, taskId, expectedRevision) {
      return serialize(async () => {
        const db = await open();
        await db.withExclusiveTransactionAsync(async (tx) => {
          await assertNoOpenConflict(tx, employeeId, taskId);
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
          await assertNoOpenConflict(tx, employeeId, taskId);
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
        return taskId === undefined ? listItems(db, employeeId) : listItems(db, employeeId, taskId);
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
    async resolveConflict(write) {
      return serialize(async () => {
        const db = await open();
        let result: { draft: LocalDraft | null; operation: OutboxItem | null } | undefined;
        await db.withExclusiveTransactionAsync(async (tx) => {
          result = await applyConflictResolution(tx, write);
        });
        return result!;
      });
    },
    async listConflictResolutions(employeeId) {
      return serialize(async () => {
        const db = await open();
        const resolutions = await db.getAllAsync<ResolutionRow>(`SELECT resolution_id, employee_id, task_id, choice, server_revision,
          server_state, new_operation_id, created_at FROM conflict_resolutions WHERE employee_id = ? ORDER BY created_at, rowid`, employeeId);
        const items = await db.getAllAsync<ResolutionItemRow>(`SELECT operation_id, resolution_id, role, kind, snapshot_id
          FROM conflict_resolution_items WHERE employee_id = ? ORDER BY rowid`, employeeId);
        return resolutions.map((row): ConflictResolution => ({
          resolutionId: row.resolution_id, employeeId: row.employee_id, taskId: row.task_id, choice: row.choice,
          serverRevision: row.server_revision, serverState: row.server_state, newOperationId: row.new_operation_id, createdAt: row.created_at,
          items: items.filter((item) => item.resolution_id === row.resolution_id)
            .map((item) => ({ operationId: item.operation_id, role: item.role, kind: item.kind, snapshotId: item.snapshot_id })),
        }));
      });
    },
    async createCorrectionDraft(write) {
      return serialize(async () => {
        const db = await open();
        let result: { draft: LocalDraft; correction: CorrectionDraft } | undefined;
        await db.withExclusiveTransactionAsync(async (tx) => {
          result = await applyCorrectionDraft(tx, write);
        });
        return result!;
      });
    },
    async listCorrectionDrafts(employeeId) {
      return serialize(async () => listCorrections(await open(), employeeId));
    },
  };
}

type ResolutionRow = {
  resolution_id: string; employee_id: string; task_id: string; choice: ConflictResolution["choice"]; server_revision: number;
  server_state: ConflictResolution["serverState"]; new_operation_id: string | null; created_at: number;
};
type ResolutionItemRow = { operation_id: string; resolution_id: string; role: "conflict" | "withdrawn"; kind: OutboxItem["kind"]; snapshot_id: string };

/** One explicit resolution; every refusal throws before commit, so nothing changes. */
async function applyConflictResolution(tx: SqlTransaction, write: ConflictResolutionWrite): Promise<{ draft: LocalDraft | null; operation: OutboxItem | null }> {
  const { employeeId, taskId, resolutionId, createdAt } = write;
  const items = await listItems(tx, employeeId, taskId);
  const open = items.filter(isOpenConflict).sort((a, b) => a.sequence - b.sequence);
  const expected = new Set(write.conflictOperationIds);
  if (!open.length || open.length !== expected.size || open.some((item) => !expected.has(item.operationId))) {
    throw new ConflictResolutionError("stale");
  }
  const unresolved = items.filter((item) => item.status !== "resolved");
  if (unresolved.some((item) => item.attemptCount > 0)) throw new ConflictResolutionError("attempted");
  if (write.choice === "keep-local") {
    if (write.server.state !== "draft" || !write.operation) throw new ConflictResolutionError("server-submitted");
    const stored = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
    if (stored?.revision !== write.operation.snapshot.revision) throw new ConflictResolutionError("local-unavailable");
  }

  await tx.runAsync(`INSERT INTO conflict_resolutions (resolution_id, employee_id, task_id, choice, server_revision, server_state, new_operation_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  resolutionId, employeeId, taskId, write.choice, write.server.revision, write.server.state, write.operation?.operationId ?? null, createdAt);
  for (const [role, covered] of [["conflict", open], ["withdrawn", unresolved]] as const) {
    for (const item of covered) {
      await tx.runAsync(`INSERT INTO conflict_resolution_items (operation_id, resolution_id, employee_id, role, kind, snapshot_id)
        VALUES (?, ?, ?, ?, ?, ?)`, item.operationId, resolutionId, employeeId, role, item.kind, item.snapshotId);
    }
  }
  // Withdrawn items were never attempted (the conflict paused the task); their snapshots are kept.
  for (const item of unresolved) {
    await tx.runAsync("DELETE FROM outbox_operations WHERE operation_id = ? AND employee_id = ? AND attempt_count = 0", item.operationId, employeeId);
  }
  await tx.runAsync(`INSERT INTO task_sync_state (employee_id, task_id, server_revision, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(employee_id, task_id) DO UPDATE SET server_revision = excluded.server_revision, updated_at = excluded.updated_at`,
  employeeId, taskId, write.server.revision, createdAt);

  if (write.choice === "keep-local") {
    // The lineage references the newest open conflict; the base is the fetched server revision set above.
    const operation = await insertOperation(tx, write.operation!, { conflictOperationId: open.at(-1)!.operationId });
    return { draft: write.operation!.snapshot, operation };
  }
  const previous = await tx.getFirstAsync<{ revision: number; draft_id: string; created_at: number; saved_at: number }>(
    "SELECT revision, draft_id, created_at, saved_at FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
  if (!write.replacement) {
    await tx.runAsync("DELETE FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
    return { draft: null, operation: null };
  }
  const { payload, draftId, savedAt } = write.replacement;
  const record: LocalDraft = {
    id: previous?.draft_id ?? draftId, employeeId, taskId, payloadSchemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
    revision: (previous?.revision ?? 0) + 1, payload,
    createdAt: Math.min(previous?.created_at ?? savedAt, savedAt), savedAt: Math.max(savedAt, previous?.saved_at ?? 0),
  };
  await writeDraft(tx, record, previous?.revision);
  return { draft: record, operation: null };
}

/** One correction; every refusal throws before commit, so nothing changes. */
async function applyCorrectionDraft(tx: SqlTransaction, write: CorrectionDraftWrite): Promise<{ draft: LocalDraft; correction: CorrectionDraft }> {
  const { employeeId, taskId, createdAt } = write;
  const items = await listItems(tx, employeeId, taskId);
  const refusal = findOpenRefusal(items, await listCorrections(tx, employeeId, taskId));
  if (!refusal || refusal.operationId !== write.rejectedOperationId) throw new CorrectionDraftError("stale");
  if (items.some(isOpenConflict)) throw new CorrectionDraftError("open-conflict");
  if (items.some((item) => item.status !== "resolved")) throw new CorrectionDraftError("unresolved");
  const row = await tx.getFirstAsync<{ payload_json: string }>("SELECT payload_json FROM audit_snapshots WHERE snapshot_id = ? AND employee_id = ? AND task_id = ?",
    refusal.snapshotId, employeeId, taskId);
  let snapshot: LocalDraft;
  try {
    if (!row) throw new Error("Missing snapshot.");
    snapshot = parseLocalDraft(row.payload_json);
  } catch {
    throw new CorrectionDraftError("snapshot-unavailable");
  }
  if (snapshot.employeeId !== employeeId || snapshot.taskId !== taskId || "content" in snapshot.payload || snapshot.payload.legacyContent !== undefined) {
    throw new CorrectionDraftError("snapshot-unavailable");
  }
  // The existing row may be unreadable by this app version: only its identity columns are kept.
  const previous = await tx.getFirstAsync<{ revision: number; draft_id: string; created_at: number; saved_at: number }>(
    "SELECT revision, draft_id, created_at, saved_at FROM local_drafts WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
  const savedAt = Math.max(createdAt, previous?.saved_at ?? 0);
  const draft: LocalDraft = {
    id: previous?.draft_id ?? write.draftId, employeeId, taskId, payloadSchemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
    revision: (previous?.revision ?? 0) + 1, payload: snapshot.payload, createdAt: previous?.created_at ?? savedAt, savedAt,
  };
  const correction: CorrectionDraft = {
    correctionId: write.correctionId, employeeId, taskId, rejectedOperationId: refusal.operationId, rejectedSnapshotId: refusal.snapshotId,
    rejectedAt: refusal.resolvedAt ?? refusal.updatedAt, draftRevision: draft.revision, createdAt,
  };
  await tx.runAsync(`INSERT INTO correction_drafts (correction_id, employee_id, task_id, rejected_operation_id, rejected_snapshot_id, rejected_at,
    draft_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  correction.correctionId, employeeId, taskId, correction.rejectedOperationId, correction.rejectedSnapshotId, correction.rejectedAt, correction.draftRevision, createdAt);
  await writeDraft(tx, draft, previous?.revision);
  return { draft, correction };
}

type CorrectionRow = {
  correction_id: string; employee_id: string; task_id: string; rejected_operation_id: string; rejected_snapshot_id: string;
  rejected_at: number; draft_revision: number; created_at: number;
};
const toCorrection = (row: CorrectionRow): CorrectionDraft => ({
  correctionId: row.correction_id, employeeId: row.employee_id, taskId: row.task_id, rejectedOperationId: row.rejected_operation_id,
  rejectedSnapshotId: row.rejected_snapshot_id, rejectedAt: row.rejected_at, draftRevision: row.draft_revision, createdAt: row.created_at,
});

async function listCorrections(tx: SqlTransaction, employeeId: string, taskId?: string): Promise<CorrectionDraft[]> {
  const select = "SELECT * FROM correction_drafts WHERE employee_id = ?";
  const rows = taskId === undefined
    ? await tx.getAllAsync<CorrectionRow>(`${select} ORDER BY created_at, rowid`, employeeId)
    : await tx.getAllAsync<CorrectionRow>(`${select} AND task_id = ? ORDER BY created_at, rowid`, employeeId, taskId);
  return rows.map(toCorrection);
}

/** The refused submit named by the task's latest correction while no item carrying it was accepted, else null. */
async function unlinkedCorrection(tx: SqlTransaction, employeeId: string, taskId: string): Promise<string | null> {
  const latest = (await listCorrections(tx, employeeId, taskId)).at(-1);
  if (!latest) return null;
  const linked = await tx.getFirstAsync<{ operation_id: string }>(`SELECT operation_id FROM outbox_operations
    WHERE employee_id = ? AND task_id = ? AND correction_operation_id = ? AND outcome = 'accepted' LIMIT 1`, employeeId, taskId, latest.rejectedOperationId);
  return linked ? null : latest.rejectedOperationId;
}

type SqlTransaction = Pick<SqlDatabase, "getFirstAsync" | "getAllAsync" | "runAsync">;
type OutboxRow = {
  operation_id: string; idempotency_key: string; employee_id: string; task_id: string; sequence: number;
  kind: OutboxItem["kind"]; snapshot_id: string; base_revision: number; status: OutboxItem["status"];
  attempt_count: number; last_error: string | null; outcome: OutboxItem["outcome"]; outcome_json: string | null;
  created_at: number; updated_at: number; resolved_at: number | null;
  conflict_operation_id: string | null; conflict_resolution_id: string | null; correction_operation_id: string | null;
};
/** Every item with its lineage and, for a conflict, the resolution covering it (if any). */
const OUTBOX_SELECT = `SELECT item.operation_id, item.idempotency_key, item.employee_id, item.task_id, item.sequence, item.kind,
  item.snapshot_id, item.base_revision, item.status, item.attempt_count, item.last_error, item.outcome, item.outcome_json,
  item.created_at, item.updated_at, item.resolved_at, item.conflict_operation_id, covered.resolution_id AS conflict_resolution_id,
  item.correction_operation_id
  FROM outbox_operations item
  LEFT JOIN conflict_resolution_items covered ON covered.operation_id = item.operation_id
    AND covered.employee_id = item.employee_id AND covered.role = 'conflict'`;

function toOutboxItem(row: OutboxRow): OutboxItem {
  return {
    operationId: row.operation_id, idempotencyKey: row.idempotency_key, employeeId: row.employee_id, taskId: row.task_id,
    sequence: row.sequence, kind: row.kind, snapshotId: row.snapshot_id, baseRevision: row.base_revision, status: row.status,
    attemptCount: row.attempt_count, lastError: row.last_error, outcome: row.outcome,
    outcomeMetadata: row.outcome_json === null ? null : JSON.parse(row.outcome_json),
    createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at,
    conflictOperationId: row.conflict_operation_id, conflictResolutionId: row.conflict_resolution_id,
    correctionOperationId: row.correction_operation_id,
  };
}

async function listItems(tx: SqlTransaction, employeeId: string, taskId?: string): Promise<OutboxItem[]> {
  const rows = taskId === undefined
    ? await tx.getAllAsync<OutboxRow>(`${OUTBOX_SELECT} WHERE item.employee_id = ? ORDER BY sequence`, employeeId)
    : await tx.getAllAsync<OutboxRow>(`${OUTBOX_SELECT} WHERE item.employee_id = ? AND item.task_id = ? ORDER BY sequence`, employeeId, taskId);
  return rows.map(toOutboxItem);
}

async function readOperation(tx: SqlTransaction, employeeId: string, operationId: string): Promise<OutboxItem | null> {
  const row = await tx.getFirstAsync<OutboxRow>(`${OUTBOX_SELECT} WHERE item.employee_id = ? AND item.operation_id = ?`, employeeId, operationId);
  return row ? toOutboxItem(row) : null;
}

async function hasOpenConflict(tx: SqlTransaction, employeeId: string, taskId: string): Promise<boolean> {
  const rows = await tx.getAllAsync<OutboxRow>(`${OUTBOX_SELECT} WHERE item.employee_id = ? AND item.task_id = ?`, employeeId, taskId);
  return rows.map(toOutboxItem).some(isOpenConflict);
}

async function assertNoOpenConflict(tx: SqlTransaction, employeeId: string, taskId: string) {
  if (await hasOpenConflict(tx, employeeId, taskId)) throw new OpenConflictError();
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

type Lineage = { conflictOperationId: string | null; correctionOperationId: string | null };

/**
 * Removes unresolved `sync-draft` items and their snapshots (never-attempted ones only on supersession).
 * Returns the conflict and correction lineage a removed item carried, so the superseding item keeps it.
 */
async function removeUnresolvedSyncDrafts(tx: SqlTransaction, employeeId: string, taskId: string, neverAttemptedOnly: boolean): Promise<Lineage> {
  const rows = await tx.getAllAsync<{ operation_id: string; snapshot_id: string; conflict_operation_id: string | null; correction_operation_id: string | null }>(
    `SELECT operation_id, snapshot_id, conflict_operation_id, correction_operation_id FROM outbox_operations
    WHERE employee_id = ? AND task_id = ? AND kind = 'sync-draft' AND status <> 'resolved'${neverAttemptedOnly ? " AND attempt_count = 0" : ""}`,
  employeeId, taskId);
  const inherited: Lineage = { conflictOperationId: null, correctionOperationId: null };
  for (const row of rows) {
    inherited.conflictOperationId = row.conflict_operation_id ?? inherited.conflictOperationId;
    inherited.correctionOperationId = row.correction_operation_id ?? inherited.correctionOperationId;
    await tx.runAsync("DELETE FROM outbox_operations WHERE operation_id = ? AND employee_id = ?", row.operation_id, employeeId);
    await tx.runAsync("DELETE FROM audit_snapshots WHERE snapshot_id = ? AND employee_id = ?", row.snapshot_id, employeeId);
  }
  return inherited;
}

/** Inserts the snapshot and item. An item without inherited correction lineage carries the task's unlinked correction, if any. */
async function insertOperation(tx: SqlTransaction, operation: NewOutboxOperation, inherited: Partial<Lineage> = {}): Promise<OutboxItem> {
  const { employeeId, taskId } = operation.snapshot;
  const conflictOperationId = inherited.conflictOperationId ?? null;
  const correctionOperationId = inherited.correctionOperationId ?? await unlinkedCorrection(tx, employeeId, taskId);
  const state = await tx.getFirstAsync<{ server_revision: number }>("SELECT server_revision FROM task_sync_state WHERE employee_id = ? AND task_id = ?", employeeId, taskId);
  const next = await tx.getFirstAsync<{ next_sequence: number }>("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM outbox_operations");
  await tx.runAsync(`INSERT INTO audit_snapshots (snapshot_id, employee_id, task_id, kind, draft_revision, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  operation.snapshotId, employeeId, taskId, operation.kind, operation.snapshot.revision, JSON.stringify(operation.snapshot), operation.createdAt);
  await tx.runAsync(`INSERT INTO outbox_operations (operation_id, idempotency_key, employee_id, task_id, sequence, kind, snapshot_id,
    base_revision, status, attempt_count, created_at, updated_at, conflict_operation_id, correction_operation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
  operation.operationId, operation.idempotencyKey, employeeId, taskId, next?.next_sequence ?? 1, operation.kind, operation.snapshotId,
  state?.server_revision ?? 0, operation.createdAt, operation.createdAt, conflictOperationId, correctionOperationId);
  const item = await readOperation(tx, employeeId, operation.operationId);
  if (!item) throw new Error("Outbox operation was not committed.");
  return item;
}
