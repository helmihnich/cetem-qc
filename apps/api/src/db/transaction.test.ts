import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "./transaction.js";

test("rollback failure is reported without masking a frozen original error or skipping release", async () => {
  const originalError = Object.freeze(new Error("application failure"));
  const rollbackError = new Error("rollback failure");
  const queries: string[] = [];
  let released = false;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql === "ROLLBACK") throw rollbackError;
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      released = true;
    },
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  const reported: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => reported.push(args);

  try {
    await assert.rejects(
      withTransaction(pool, async () => {
        throw originalError;
      }),
      (error) => error === originalError,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(queries, ["BEGIN", "ROLLBACK"]);
  assert.equal(released, true);
  assert.deepEqual(reported, [["Transaction rollback failed", rollbackError]]);
});

test("release failure does not mask the callback error when rollback succeeds", async () => {
  const originalError = new Error("callback failure");
  const releaseError = new Error("release failure");
  const queries: string[] = [];
  let releaseAttempted = false;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      releaseAttempted = true;
      throw releaseError;
    },
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  const reported: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => reported.push(args);

  try {
    await assert.rejects(
      withTransaction(pool, async () => {
        throw originalError;
      }),
      (error) => error === originalError,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(queries, ["BEGIN", "ROLLBACK"]);
  assert.equal(releaseAttempted, true);
  assert.deepEqual(reported, [["Transaction release failed", releaseError]]);
});

test("release failure does not mask the callback error when rollback also fails", async () => {
  const originalError = Object.freeze(new Error("callback failure"));
  const rollbackError = new Error("rollback failure");
  const releaseError = new Error("release failure");
  const queries: string[] = [];
  let releaseAttempted = false;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql === "ROLLBACK") throw rollbackError;
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      releaseAttempted = true;
      throw releaseError;
    },
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  const reported: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => reported.push(args);

  try {
    await assert.rejects(
      withTransaction(pool, async () => {
        throw originalError;
      }),
      (error) => error === originalError,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(queries, ["BEGIN", "ROLLBACK"]);
  assert.equal(releaseAttempted, true);
  assert.deepEqual(reported, [
    ["Transaction rollback failed", rollbackError],
    ["Transaction release failed", releaseError],
  ]);
});

test("release failure is surfaced when the callback succeeds", async () => {
  const releaseError = new Error("release failure");
  const queries: string[] = [];
  let releaseAttempted = false;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      releaseAttempted = true;
      throw releaseError;
    },
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;

  await assert.rejects(
    withTransaction(pool, async () => "committed"),
    (error) => error === releaseError,
  );

  assert.deepEqual(queries, ["BEGIN", "COMMIT"]);
  assert.equal(releaseAttempted, true);
});
