import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ensureTestDatabase, missingTestDatabaseMessage, resolvePostgresTestTarget } from "./postgres.js";
import type { AdminConnector } from "./postgres.js";

function connectorSpy(failWith?: { code: string }) {
  const calls: Array<{ url: string; sql: string[] }> = [];
  const connect: AdminConnector = async (url) => {
    const call = { url, sql: [] as string[] };
    calls.push(call);
    return {
      query: async (sql: string) => {
        call.sql.push(sql);
        if (failWith) throw Object.assign(new Error("database error"), failWith);
        return {};
      },
      end: async () => undefined,
    };
  };
  return { calls, connect };
}

test("H1 the harness fails instead of skipping when no database URL is configured", () => {
  assert.throws(() => resolvePostgresTestTarget({}), { message: missingTestDatabaseMessage });
  assert.throws(() => resolvePostgresTestTarget({ DATABASE_URL: "", CETEM_QC_TEST_DATABASE_URL: "" }), { message: missingTestDatabaseMessage });
});

test("H2 non-local hosts are refused before any connection attempt", async () => {
  const spy = connectorSpy();
  for (const url of [
    "postgresql://u:p@db.example.com:5432/cetem_qc",
    "postgresql://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    "postgresql://u:p@10.0.0.5:5432/cetem_qc_test",
  ]) {
    await assert.rejects(
      async () => ensureTestDatabase(resolvePostgresTestTarget({ DATABASE_URL: url }), spy.connect),
      /non-local host/,
    );
  }
  for (const url of [
    "postgresql://u:p@localhost:5432/cetem_qc_test?host=db.example.com",
    "postgresql://u:p@127.0.0.1:5432/cetem_qc?HOST=db.example.com",
    "postgresql://u:p@localhost:5432/cetem_qc?hostaddr=10.0.0.5",
  ]) {
    await assert.rejects(
      async () => ensureTestDatabase(resolvePostgresTestTarget({ DATABASE_URL: url }), spy.connect),
      /non-local host override/,
    );
  }
  assert.equal(spy.calls.length, 0);
});

test("H3 a development database URL maps to the sibling cetem_qc_test database", async () => {
  const target = resolvePostgresTestTarget({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/cetem_qc" });
  const testUrl = new URL(target.testUrl);
  assert.equal(testUrl.pathname, "/cetem_qc_test");
  assert.equal(testUrl.hostname, "127.0.0.1");
  assert.equal(testUrl.port, "5432");
  assert.equal(testUrl.username, "u");
  assert.equal(testUrl.password, "p");
  assert.equal(new URL(target.adminUrl!).pathname, "/cetem_qc");

  const spy = connectorSpy();
  await ensureTestDatabase(target, spy.connect);
  assert.deepEqual(spy.calls, [{ url: target.adminUrl, sql: ["CREATE DATABASE cetem_qc_test"] }]);
});

test("H4 an existing cetem_qc_test_<suffix> database is used as is", async () => {
  const target = resolvePostgresTestTarget({ DATABASE_URL: "postgresql://u:p@localhost:5432/cetem_qc_test_abc" });
  assert.equal(new URL(target.testUrl).pathname, "/cetem_qc_test_abc");
  assert.equal(target.adminUrl, undefined);
  const spy = connectorSpy();
  await ensureTestDatabase(target, spy.connect);
  assert.equal(spy.calls.length, 0, "no CREATE DATABASE for an existing test database");
});

test("H5 CETEM_QC_TEST_DATABASE_URL wins over DATABASE_URL", () => {
  const target = resolvePostgresTestTarget({
    DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/cetem_qc",
    CETEM_QC_TEST_DATABASE_URL: "postgresql://t:q@[::1]:55432/cetem_qc_test",
  });
  const testUrl = new URL(target.testUrl);
  assert.equal(testUrl.port, "55432");
  assert.equal(testUrl.username, "t");
  assert.equal(target.adminUrl, undefined);
});

test("H6 a parallel CREATE DATABASE race (42P04 or 23505) counts as success; other errors fail", async () => {
  const target = resolvePostgresTestTarget({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/cetem_qc" });
  await ensureTestDatabase(target, connectorSpy({ code: "42P04" }).connect);
  await ensureTestDatabase(target, connectorSpy({ code: "23505" }).connect);
  await assert.rejects(() => ensureTestDatabase(target, connectorSpy({ code: "42501" }).connect), { code: "42501" });
});

test("H7 importing db/migrate.ts neither connects nor runs the migration entry point", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgresql://u:p@127.0.0.1:1/cetem_qc" };
  delete env.CETEM_QC_TEST_DATABASE_URL;
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "-e",
    "import('./src/db/migrate.ts').then((m) => { if (typeof (m.migrate ?? m.default?.migrate) !== 'function') process.exit(3); setTimeout(() => {}, 200); })",
  ], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /migration/i);
});

test("H8 running db/migrate.ts as the entry point invokes the migration", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgresql://u:p@127.0.0.1:1/cetem_qc" };
  delete env.CETEM_QC_TEST_DATABASE_URL;
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], { encoding: "utf8", env });
  assert.notEqual(result.status, 0, "an unreachable database fails the migration command");
  assert.match(`${result.stdout}${result.stderr}`, /Database migration failed/);
});
