const DATABASE_VERSION = 1;

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
    return;
  }
  await db.withExclusiveTransactionAsync(async (tx) => {
    const inside = await tx.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
    if ((inside?.user_version ?? 0) !== 0) throw new Error("Local draft database changed during migration.");
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
      PRAGMA user_version = 1;
    `);
  });
}
