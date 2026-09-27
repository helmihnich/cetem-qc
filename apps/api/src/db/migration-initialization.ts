import type { Pool } from "pg";
import { withTransaction } from "./transaction.js";

const migrationLockKey = 1_339_347_525;

export async function initializeMigrationTable(pool: Pool): Promise<void> {
  await withTransaction(pool, async (transaction) => {
    await transaction.query("SELECT pg_advisory_xact_lock($1)", [migrationLockKey]);
    await transaction.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });
}
