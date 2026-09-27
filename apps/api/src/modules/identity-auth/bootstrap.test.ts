import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { bootstrapFirstResponsable } from "./bootstrap.js";
import { verifyPassword } from "./password.js";

function fakePool(existing = false) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql: sql.trim(), values });
        return { rows: [], rowCount: sql.includes("SELECT 1 FROM identity_accounts") && existing ? 1 : 0 };
      },
      release: () => undefined,
    } as unknown as PoolClient),
  } as unknown as Pool;
  return { pool, queries };
}

test("bootstrap stores only a salted hash and marks the first Responsable for password change", async () => {
  const { pool, queries } = fakePool();
  const result = await bootstrapFirstResponsable(pool, { email: "RESP@example.com", displayName: "First Owner" });
  const insert = queries.find(({ sql }) => sql.startsWith("INSERT INTO identity_accounts"));
  assert.ok(insert);
  assert.deepEqual(insert.values?.slice(0, 2), ["resp@example.com", "First Owner"]);
  assert.match(insert.sql, /VALUES \(\$1, \$2, 'responsable', \$3, true\)/);
  assert.equal(typeof insert.values?.[2], "string");
  assert.notEqual(insert.values?.[2], result.temporaryPassword);
  assert.equal(await verifyPassword(result.temporaryPassword, insert.values?.[2] as string), true);
  assert.equal(await verifyPassword("wrong", insert.values?.[2] as string), false);
});

test("bootstrap refuses a second account without exposing or inserting a new credential", async () => {
  const { pool, queries } = fakePool(true);
  await assert.rejects(
    bootstrapFirstResponsable(pool, { email: "next@example.com", displayName: "Second" }),
    /single-use/,
  );
  assert.equal(queries.some(({ sql }) => sql.startsWith("INSERT INTO identity_accounts")), false);
});

test("bootstrap rejects invalid operator input before database work", async () => {
  const { pool, queries } = fakePool();
  await assert.rejects(bootstrapFirstResponsable(pool, { email: "bad", displayName: "Owner" }), /valid email/);
  assert.equal(queries.length, 0);
});
