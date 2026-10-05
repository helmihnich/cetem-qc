const DATABASE_VERSION = 5;
const OUTBOX_TABLES = ["audit_snapshots", "outbox_operations", "task_sync_state", "conflict_resolutions", "conflict_resolution_items", "correction_drafts"] as const;

type MigrationTransaction = {
  getFirstAsync<T>(sql: string): Promise<T | null>;
  execAsync(sql: string): Promise<void>;
};
type MigrationDatabase = MigrationTransaction & {
  withExclusiveTransactionAsync(operation: (tx: MigrationTransaction) => Promise<void>): Promise<void>;
};

export async function initializeDraftDatabase(db: MigrationDatabase): Promise<void> {
  const version = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const current = version?.user_version ?? 0;
  if (current > DATABASE_VERSION || current < 0) throw new Error("Unsupported local draft database version.");
  if (current === DATABASE_VERSION) {
    const table = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_drafts'");
    if (table?.name !== "local_drafts") throw new Error("Local draft database schema is incomplete.");
    const cache = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'synchronized_tasks'");
    if (cache?.name !== "synchronized_tasks") throw new Error("Local synchronized-task schema is incomplete.");
    for (const name of OUTBOX_TABLES) {
      const outbox = await db.getFirstAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`);
      if (outbox?.name !== name) throw new Error("Local outbox schema is incomplete.");
    }
    const lineage = await db.getFirstAsync<{ name: string }>("SELECT name FROM pragma_table_info('outbox_operations') WHERE name = 'conflict_operation_id'");
    if (lineage?.name !== "conflict_operation_id") throw new Error("Local outbox schema is incomplete.");
    const correction = await db.getFirstAsync<{ name: string }>("SELECT name FROM pragma_table_info('outbox_operations') WHERE name = 'correction_operation_id'");
    if (correction?.name !== "correction_operation_id") throw new Error("Local outbox schema is incomplete.");
    return;
  }
  await db.withExclusiveTransactionAsync(async (tx) => {
    const inside = await tx.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    const versionInside = inside?.user_version ?? 0;
    if (versionInside !== current) throw new Error("Local draft database changed during migration.");
    if (versionInside === 0) {
      await tx.execAsync(`
        CREATE TABLE local_drafts (
          employee_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          draft_id TEXT NOT NULL UNIQUE,
          payload_schema_version INTEGER NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          created_at INTEGER NOT NULL,
          saved_at INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY (employee_id, task_id)
        );
        CREATE INDEX local_drafts_employee_saved ON local_drafts(employee_id, saved_at DESC);
      `);
    }
    if (versionInside < 2) {
      await tx.execAsync(`
        CREATE TABLE synchronized_tasks (
          employee_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          task_json TEXT NOT NULL,
          synchronized_at INTEGER NOT NULL,
          PRIMARY KEY (employee_id, task_id)
        );
        PRAGMA user_version = 2;
      `);
    }
    if (versionInside < 3) {
      // Creates tables only: existing draft and cached-task rows are never touched.
      await tx.execAsync(`
        CREATE TABLE audit_snapshots (
          snapshot_id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('sync-draft', 'submit')),
          draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TRIGGER audit_snapshots_insert_only BEFORE UPDATE ON audit_snapshots
        BEGIN SELECT RAISE(ABORT, 'audit snapshots are insert-only'); END;
        CREATE TABLE outbox_operations (
          operation_id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          employee_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('sync-draft', 'submit')),
          snapshot_id TEXT NOT NULL UNIQUE REFERENCES audit_snapshots(snapshot_id),
          base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
          status TEXT NOT NULL CHECK (status IN ('queued', 'in-flight', 'retry-paused', 'blocked', 'resolved')),
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          outcome TEXT CHECK (outcome IN ('accepted', 'rejected', 'conflict')),
          outcome_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          resolved_at INTEGER,
          CHECK ((status = 'resolved') = (outcome IS NOT NULL))
        );
        CREATE INDEX outbox_employee_task_seq ON outbox_operations(employee_id, task_id, sequence);
        CREATE TABLE task_sync_state (
          employee_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          server_revision INTEGER NOT NULL CHECK (server_revision >= 0),
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (employee_id, task_id)
        );
        PRAGMA user_version = 3;
      `);
    }
    if (versionInside < 4) {
      // Adds a nullable column and insert-only tables: no existing row is changed.
      await tx.execAsync(`
        ALTER TABLE outbox_operations ADD COLUMN conflict_operation_id TEXT;
        CREATE TABLE conflict_resolutions (
          resolution_id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          choice TEXT NOT NULL CHECK (choice IN ('keep-local', 'discard-local')),
          server_revision INTEGER NOT NULL CHECK (server_revision >= 0),
          server_state TEXT NOT NULL CHECK (server_state IN ('draft', 'submitted')),
          new_operation_id TEXT,
          created_at INTEGER NOT NULL,
          CHECK ((choice = 'keep-local') = (new_operation_id IS NOT NULL))
        );
        CREATE TABLE conflict_resolution_items (
          operation_id TEXT PRIMARY KEY,
          resolution_id TEXT NOT NULL REFERENCES conflict_resolutions(resolution_id),
          employee_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('conflict', 'withdrawn')),
          kind TEXT NOT NULL CHECK (kind IN ('sync-draft', 'submit')),
          snapshot_id TEXT NOT NULL
        );
        CREATE TRIGGER conflict_resolutions_insert_only BEFORE UPDATE ON conflict_resolutions
        BEGIN SELECT RAISE(ABORT, 'conflict resolutions are insert-only'); END;
        CREATE TRIGGER conflict_resolution_items_insert_only BEFORE UPDATE ON conflict_resolution_items
        BEGIN SELECT RAISE(ABORT, 'conflict resolution items are insert-only'); END;
        PRAGMA user_version = 4;
      `);
    }
    if (versionInside < 5) {
      // Adds a nullable column and an insert-only table: no existing row is changed.
      await tx.execAsync(`
        ALTER TABLE outbox_operations ADD COLUMN correction_operation_id TEXT;
        CREATE TABLE correction_drafts (
          correction_id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          rejected_operation_id TEXT NOT NULL UNIQUE,
          rejected_snapshot_id TEXT NOT NULL,
          rejected_at INTEGER NOT NULL,
          draft_revision INTEGER NOT NULL CHECK (draft_revision >= 1),
          created_at INTEGER NOT NULL
        );
        CREATE TRIGGER correction_drafts_no_update BEFORE UPDATE ON correction_drafts
        BEGIN SELECT RAISE(ABORT, 'correction_drafts is insert-only'); END;
        PRAGMA user_version = 5;
      `);
    }
  });
}
