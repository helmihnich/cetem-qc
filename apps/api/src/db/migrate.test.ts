import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { initializeMigrationTable } from "./migration-initialization.js";

test("concurrent migration initialization is serialized behind the advisory lock", async () => {
  const events: string[] = [];
  let lockOwner = false;
  let releaseLock: (() => void) | undefined;
  let waitForRelease: Promise<void> | undefined;

  const pool = {
    connect: async () => {
      const client = {
        query: async (sql: string) => {
          const query = sql.trim();
          if (query === "BEGIN") {
            events.push("begin");
          } else if (query.startsWith("SELECT pg_advisory_xact_lock")) {
            events.push("lock-wait");
            if (lockOwner) await waitForRelease;
            lockOwner = true;
            events.push("lock-acquired");
          } else if (query.startsWith("CREATE TABLE IF NOT EXISTS schema_migrations")) {
            events.push("create");
            await Promise.resolve();
          } else if (query === "COMMIT") {
            events.push("commit");
            lockOwner = false;
            releaseLock?.();
            releaseLock = undefined;
            waitForRelease = undefined;
          }
          return { rows: [], rowCount: 0 };
        },
        release: () => events.push("release"),
      };
      if (!waitForRelease) {
        waitForRelease = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      }
      return client as unknown as PoolClient;
    },
  } as unknown as Pool;

  await Promise.all([
    initializeMigrationTable(pool),
    initializeMigrationTable(pool),
  ]);

  assert.equal(events.filter((event) => event === "create").length, 2);
  const firstCommit = events.indexOf("commit");
  const secondLock = events.lastIndexOf("lock-acquired");
  assert.ok(firstCommit < secondLock, `expected first commit before second lock: ${events}`);
  assert.deepEqual(events.filter((event) => event === "lock-acquired").length, 2);
});
