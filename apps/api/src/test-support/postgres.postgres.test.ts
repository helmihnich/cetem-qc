import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import { migrate } from "../db/migrate.js";
import { ensureTestDatabase, preparePostgresTestDatabase, resolvePostgresTestTarget, withPostgresTestSchema } from "./postgres.js";
import type { AdminConnector } from "./postgres.js";

async function migrationVersions(): Promise<string[]> {
  return (await readdir("src/db/migrations"))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map((file) => file.slice(0, -4));
}

async function schemaExists(schema: string): Promise<boolean> {
  const { testUrl } = await preparePostgresTestDatabase();
  const client = new Client({ connectionString: testUrl });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_namespace WHERE nspname = $1", [schema]);
    return result.rows[0]?.count !== "0";
  } finally {
    await client.end();
  }
}

test("P2 the harness applies every migration with the production runner, and a second run applies nothing", async () => {
  await withPostgresTestSchema(async ({ pool, schema }) => {
    const applied = await pool.query<{ version: string; schema: string }>(
      "SELECT version, current_schema() AS schema FROM schema_migrations ORDER BY version",
    );
    assert.deepEqual(applied.rows.map((row) => row.version), await migrationVersions());
    assert.equal(applied.rows[0]?.schema, schema, "migrations land in the isolated schema");

    const before = await pool.query<{ version: string; applied_at: Date }>("SELECT version, applied_at FROM schema_migrations ORDER BY version");
    await migrate(pool);
    const after = await pool.query<{ version: string; applied_at: Date }>("SELECT version, applied_at FROM schema_migrations ORDER BY version");
    assert.deepEqual(after.rows, before.rows);
  });
});

test("P2 a staged upgrade stops at the requested version and finishes with the remaining migrations", async () => {
  await withPostgresTestSchema(async ({ pool, migrate: finishMigrations }) => {
    const staged = await pool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
    assert.deepEqual(staged.rows.map((row) => row.version), ["0001_identity_accounts", "0002_identity_authentication", "0003_identity_sessions"]);
    await finishMigrations();
    const complete = await pool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
    assert.deepEqual(complete.rows.map((row) => row.version), await migrationVersions());
  }, { migrateThrough: "0003_identity_sessions" });
});

test("P3 each test schema is dropped after the test, including after a failure", async () => {
  let passedSchema = "";
  await withPostgresTestSchema(async ({ schema }) => {
    passedSchema = schema;
    assert.equal(await schemaExists(schema), true);
  });
  assert.equal(await schemaExists(passedSchema), false);

  let failedSchema = "";
  await assert.rejects(() => withPostgresTestSchema(async ({ schema }) => {
    failedSchema = schema;
    throw new Error("planned failure");
  }), /planned failure/);
  assert.equal(await schemaExists(failedSchema), false);
});

test("P4 only CREATE DATABASE is sent to the source database; test data stays in cetem_qc_test", async () => {
  const target = resolvePostgresTestTarget();
  const sourceStatements: string[] = [];
  const recordingConnector: AdminConnector = async (connectionString) => {
    const client = new Client({ connectionString });
    await client.connect();
    return {
      query: async (sql: string) => {
        sourceStatements.push(sql);
        return client.query(sql);
      },
      end: () => client.end(),
    };
  };
  await ensureTestDatabase(target, recordingConnector);
  if (target.adminUrl) assert.deepEqual(sourceStatements, ["CREATE DATABASE cetem_qc_test"]);
  else assert.deepEqual(sourceStatements, []);

  await withPostgresTestSchema(async ({ pool }) => {
    const database = await pool.query<{ name: string }>("SELECT current_database() AS name");
    assert.match(database.rows[0]?.name ?? "", /^cetem_qc_test(_[a-z0-9_]+)?$/i);
  });
});
