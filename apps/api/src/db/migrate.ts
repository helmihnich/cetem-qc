import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { initializeMigrationTable } from "./migration-initialization.js";
import { withTransaction } from "./transaction.js";

const migrationsDirectory = "src/db/migrations";
const migrationLockKey = 1_339_347_525;

export interface MigrateOptions {
  /** Stops after this version (e.g. "0003_identity_sessions"); tests use it to reproduce staged upgrades. */
  through?: string;
}

export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<void> {
  await initializeMigrationTable(pool);

  const { through } = options;
  const allFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  if (through !== undefined && !allFiles.includes(`${through}.sql`)) {
    throw new Error(`Unknown migration version ${through}`);
  }
  const files = allFiles.filter((file) => through === undefined || file.slice(0, -4) <= through);

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

// Run only as the db:migrate entry point; importing this module must neither connect nor migrate.
if (typeof require !== "undefined" && require.main === module) void main();
