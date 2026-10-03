import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { migrate } from "../db/migrate.js";
import type { MigrateOptions } from "../db/migrate.js";

// Test-only PostgreSQL harness: never imported by src/index.ts and never shipped.
// Every PostgreSQL test runs in its own migrated schema inside a cetem_qc_test* database
// on a local server, and the harness refuses everything else before connecting.

export const missingTestDatabaseMessage =
  "PostgreSQL tests need DATABASE_URL or CETEM_QC_TEST_DATABASE_URL (local Docker database)";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const hostOverrideParameters = new Set(["host", "hostaddr"]);
const testDatabaseName = "cetem_qc_test";
const testDatabasePattern = /^cetem_qc_test(_[a-z0-9_]+)?$/i;
const duplicateDatabase = "42P04";
// Concurrent CREATE DATABASE calls can also lose on the pg_database unique index.
const uniqueViolation = "23505";

export interface PostgresTestTarget {
  /** Database the test schemas live in; always named cetem_qc_test or cetem_qc_test_<suffix>. */
  testUrl: string;
  /** Database used once to create cetem_qc_test; undefined when the given URL is already a test database. */
  adminUrl?: string;
}

export interface AdminConnection {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export type AdminConnector = (connectionString: string) => Promise<AdminConnection>;

export function resolvePostgresTestTarget(env: NodeJS.ProcessEnv = process.env): PostgresTestTarget {
  const configured = env.CETEM_QC_TEST_DATABASE_URL || env.DATABASE_URL;
  if (!configured) throw new Error(missingTestDatabaseMessage);

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("PostgreSQL test database URL is not a valid URL");
  }
  if (!localHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`Refusing to run PostgreSQL tests against non-local host ${url.hostname}`);
  }
  // pg lets ?host= / ?hostaddr= override the URL host, which would bypass the local-host check.
  const hostOverride = [...url.searchParams.keys()].find((key) => hostOverrideParameters.has(key.toLowerCase()));
  if (hostOverride) throw new Error(`Refusing to run PostgreSQL tests with a non-local host override (${hostOverride})`);

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (testDatabasePattern.test(databaseName)) return { testUrl: url.toString() };

  const testUrl = new URL(url.toString());
  testUrl.pathname = `/${testDatabaseName}`;
  return { testUrl: testUrl.toString(), adminUrl: url.toString() };
}

const connectAdmin: AdminConnector = async (connectionString) => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

/** Creates cetem_qc_test next to the given database when needed; the only statement sent to that database. */
export async function ensureTestDatabase(target: PostgresTestTarget, connect: AdminConnector = connectAdmin): Promise<void> {
  if (!target.adminUrl) return;
  const admin = await connect(target.adminUrl);
  try {
    await admin.query(`CREATE DATABASE ${testDatabaseName}`);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== duplicateDatabase && code !== uniqueViolation) throw error;
  } finally {
    await admin.end();
  }
}

let preparedTarget: Promise<PostgresTestTarget> | undefined;

export function preparePostgresTestDatabase(): Promise<PostgresTestTarget> {
  preparedTarget ??= (async () => {
    const target = resolvePostgresTestTarget();
    await ensureTestDatabase(target);
    return target;
  })();
  return preparedTarget;
}

export interface PostgresTestSchema {
  /** Pool whose every connection uses the isolated schema as its search_path. */
  pool: Pool;
  schema: string;
  /** Applies further migrations with the production runner (all remaining ones unless `through` is given). */
  migrate(options?: MigrateOptions): Promise<void>;
}

export interface PostgresTestSchemaOptions {
  /** Applies migrations only through this version first, to reproduce a production upgrade with existing data. */
  migrateThrough?: string;
  maxConnections?: number;
}

export async function withPostgresTestSchema(
  run: (context: PostgresTestSchema) => Promise<void>,
  options: PostgresTestSchemaOptions = {},
): Promise<void> {
  const { testUrl } = await preparePostgresTestDatabase();
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: testUrl });
  await admin.connect();
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const scopedPool = new Pool({
      connectionString: testUrl,
      max: options.maxConnections ?? 4,
      options: `-c search_path="${schema}"`,
    });
    pool = scopedPool;
    scopedPool.on("error", (error) => console.error("Unexpected PostgreSQL test pool error", error));
    await migrate(scopedPool, { through: options.migrateThrough });
    await run({ pool: scopedPool, schema, migrate: (migrateOptions) => migrate(scopedPool, migrateOptions) });
  } finally {
    try {
      // The schema is dropped even when closing the pool fails, so no test schema leaks.
      try {
        await pool?.end();
      } finally {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      await admin.end();
    }
  }
}
