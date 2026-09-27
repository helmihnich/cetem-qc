import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { initializeMigrationTable } from "./migration-initialization.js";
import { withTransaction } from "./transaction.js";

const migrationsDirectory = "src/db/migrations";
const migrationLockKey = 1_339_347_525;

async function migrate(pool: Pool): Promise<void> {
  await initializeMigrationTable(pool);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const version = file.slice(0, -4);
    const migration = await readFile(resolve(migrationsDirectory, file), "utf8");
    await withTransaction(pool, async (transaction) => {
      await transaction.query("SELECT pg_advisory_xact_lock($1)", [migrationLockKey]);
      const applied = await transaction.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version],
      );
      if (applied.rowCount) return;

      await transaction.query(migration);
      await transaction.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    });
    console.info(`Applied migration ${version}`);
  }
}

async function main(): Promise<void> {
  const { databasePool } = await import("./pool.js");
  try {
    await migrate(databasePool);
  } catch (error) {
    console.error("Database migration failed", error);
    process.exitCode = 1;
  } finally {
    await databasePool.end();
  }
}

void main();
