const DATABASE_VERSION = 2;

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
  });
}
