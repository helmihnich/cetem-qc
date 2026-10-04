const DATABASE_VERSION = 3;
const OUTBOX_TABLES = ["audit_snapshots", "outbox_operations", "task_sync_state"] as const;

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
  });
}
