import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { initializeMigrationTable } from "./migration-initialization.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { listOwnTeamEmployees } from "../modules/team-access/queries/list-own-team-employees.js";

test("team migration backfills one team for each existing Responsable and preserves account data", async () => {
  const migration = await readFile(resolve("src/db/migrations/0004_team_membership.sql"), "utf8");
  const existing = { id: "responsable-1", email: "lead@example.com", role: "responsable", password_hash: "preserved-hash", must_change_password: true, is_active: true };
  const teams = new Map<string, string>();
  const employees = [{ first_name: "Amel", surname: "Ben Ali", email: "amel@example.com", is_active: true, team_id: "team-1", role: "employe", id: "employee-1" }];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      const query = sql.trim();
      if (query.includes("INSERT INTO identity_teams")) {
        assert.match(query, /SELECT id FROM identity_accounts[\s\S]*role = 'responsable'[\s\S]*ON CONFLICT \(responsable_account_id\) DO NOTHING/);
        if (!teams.has(existing.id)) teams.set(existing.id, "team-1");
        return { rows: [], rowCount: teams.size };
      }
      if (query.includes("FROM identity_teams team")) {
        const owner = values?.[0];
        return { rows: employees.filter((employee) => employee.team_id === teams.get(String(owner))).map(({ id, first_name, surname, email, is_active }) => ({ id, first_name, surname, email, is_active })), rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;

  assert.match(migration, /CREATE TABLE identity_teams/);
  assert.doesNotMatch(migration, /UPDATE\s+identity_accounts/i);
  await pool.query(migration);
  const accountAfter = { ...existing };
  assert.deepEqual(accountAfter, existing);
  assert.equal(teams.get(existing.id), "team-1");
  assert.deepEqual(await listOwnTeamEmployees(pool, existing.id), [{ id: "employee-1", firstName: "Amel", surname: "Ben Ali", email: "amel@example.com", active: true }]);
  await pool.query(migration);
  assert.equal(teams.size, 1);
});

test("employee email uniqueness is enforced case-insensitively by PostgreSQL", async () => {
  const migration = await readFile(resolve("src/db/migrations/0005_employee_email_normalization.sql"), "utf8");
  assert.match(migration, /CREATE UNIQUE INDEX identity_accounts_email_case_insensitive_unique/);
  assert.match(migration, /ON identity_accounts \(lower\(email\)\)/);
});

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
