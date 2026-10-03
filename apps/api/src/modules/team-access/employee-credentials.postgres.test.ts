import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createOwnTeamEmployee, DuplicateEmployeeEmailError, regenerateOwnTeamEmployeeCredential, updateOwnTeamEmployeeStatus } from "./employee-credentials.js";
import { hashPassword, verifyPassword } from "../identity-auth/index.js";
import { withPostgresTestSchema } from "../../test-support/postgres.js";

test("PostgreSQL commits one account and one team membership for concurrent canonical-email requests", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const setup = await pool.connect();
    let setupReleased = false;
    const email = `story32-${randomUUID()}@example.test`;
    let responsableId: string | undefined;
    let teamId: string | undefined;

    try {
      const index = await setup.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'identity_accounts_email_case_insensitive_unique'",
      );
      assert.match(index.rows[0]?.indexdef ?? "", /UNIQUE INDEX.*\(lower\(email\)\)/i, "PostgreSQL must enforce canonical email uniqueness");

      const fixture = await setup.query<{ id: string; team_id: string }>(
        `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password)
         VALUES ($1, $2, 'responsable', 'fixture-hash', false) RETURNING id`,
        [`story32-owner-${randomUUID()}@example.test`, "Story 3.2 integration owner"],
      );
      responsableId = fixture.rows[0]!.id;
      const team = await setup.query<{ id: string }>(
        "INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [responsableId],
      );
      teamId = team.rows[0]!.id;
      setup.release();
      setupReleased = true;

      const requests = await Promise.allSettled([
        createOwnTeamEmployee(pool, responsableId, { firstName: "Nour", surname: "Ali", email }),
        createOwnTeamEmployee(pool, responsableId, { firstName: "Nour", surname: "Ali", email: email.toUpperCase() }),
      ]);
      const successes = requests.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createOwnTeamEmployee>>> => result.status === "fulfilled");
      const failures = requests.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      assert.equal(successes.length, 1, "exactly one concurrent create must succeed");
      assert.equal(failures.length, 1, "exactly one concurrent create must lose");
      assert.ok(failures[0]!.reason instanceof DuplicateEmployeeEmailError, "the losing create must map the email-index violation to conflict");

      const counts = await pool.query<{ account_count: string; membership_count: string }>(
        `SELECT count(*)::text AS account_count,
                count(*) FILTER (WHERE team_id = $2)::text AS membership_count
         FROM identity_accounts WHERE lower(email) = lower($1)`, [email, teamId],
      );
      assert.equal(counts.rows[0]?.account_count, "1");
      assert.equal(counts.rows[0]?.membership_count, "1", "only the winning transaction may create a team membership");
      assert.equal(successes[0]!.value.employee.email, email);
      assert.equal(successes[0]!.value.temporaryCredential.length > 0, true);
    } finally {
      if (!setupReleased) setup.release();
    }
  });
});

test("PostgreSQL regeneration enforces same-team, role, active, and activation predicates", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const setup = await pool.connect();
    let setupReleased = false;
    const originalCredential = "previous-temporary-credential";
    const originalHash = await hashPassword(originalCredential);
    try {

      const insertResponsable = async (email: string) => (await setup.query<{ id: string }>(
        `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password)
         VALUES ($1, $2, 'responsable', $3, false) RETURNING id`,
        [email, "Story 3.2 test Responsable", originalHash],
      )).rows[0]!.id;
      const ownerId = await insertResponsable(`owner-${randomUUID()}@example.test`);
      const otherOwnerId = await insertResponsable(`other-${randomUUID()}@example.test`);
      const ownTeamId = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [ownerId])).rows[0]!.id;
      const otherTeamId = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [otherOwnerId])).rows[0]!.id;

      const addTarget = async (name: string, options: { teamId: string; role?: "responsable" | "employe"; active?: boolean; mustChange?: boolean }) => {
        const email = `${name}-${randomUUID()}@example.test`;
        return (await setup.query<{ id: string }>(
          `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, is_active, team_id, first_name, surname)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'Test', $8) RETURNING id`,
          [email, `Story 3.2 ${name}`, options.role ?? "employe", originalHash, options.mustChange ?? true, options.active ?? true, options.teamId, name],
        )).rows[0]!.id;
      };
      const targets = [
        { label: "other team", id: await addTarget("other-team", { teamId: otherTeamId }) },
        { label: "non Employé role", id: await addTarget("wrong-role", { teamId: ownTeamId, role: "responsable" }) },
        { label: "inactive", id: await addTarget("inactive", { teamId: ownTeamId, active: false }) },
        { label: "already activated", id: await addTarget("activated", { teamId: ownTeamId, mustChange: false }) },
      ];
      const positiveId = await addTarget("eligible", { teamId: ownTeamId });
      const servicePool = pool;

      const snapshot = async () => {
        const accounts = await servicePool.query(
          `SELECT id, email, display_name, role, password_hash, must_change_password, is_active, team_id, first_name, surname
           FROM identity_accounts ORDER BY id`,
        );
        const teams = await servicePool.query("SELECT id, responsable_account_id, created_at FROM identity_teams ORDER BY id");
        return { accounts: accounts.rows, teams: teams.rows };
      };

      setup.release();
      setupReleased = true;
      for (const target of targets) {
        const before = await snapshot();
        const result = await regenerateOwnTeamEmployeeCredential(servicePool, ownerId, target.id);
        assert.equal(result, undefined, `${target.label} regeneration must be refused`);
        assert.deepEqual(await snapshot(), before, `${target.label} rejection must preserve all account and team state`);
      }

      const positiveBefore = await snapshot();
      const result = await regenerateOwnTeamEmployeeCredential(servicePool, ownerId, positiveId);
      assert.ok(result, "active same-team Employé awaiting activation can regenerate");
      assert.match(result.temporaryCredential, /^[A-Za-z0-9_-]{32}$/);
      assert.notEqual(result.temporaryCredential, originalCredential);
      const account = await servicePool.query<{ password_hash: string; must_change_password: boolean }>(
        "SELECT password_hash, must_change_password FROM identity_accounts WHERE id = $1", [positiveId],
      );
      assert.equal(account.rows[0]?.must_change_password, true);
      assert.match(account.rows[0]?.password_hash ?? "", /^scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
      assert.notEqual(account.rows[0]?.password_hash, result.temporaryCredential);
      const oldTargetRow = positiveBefore.accounts.find((row) => (row as { id: string }).id === positiveId) as { password_hash: string } | undefined;
      assert.ok(oldTargetRow);
      assert.notEqual(account.rows[0]?.password_hash, oldTargetRow.password_hash);
      assert.equal(await verifyPassword(originalCredential, account.rows[0]!.password_hash), false);
      assert.equal(await verifyPassword(result.temporaryCredential, account.rows[0]!.password_hash), true);
      const after = await snapshot();
      assert.equal(after.accounts.length, positiveBefore.accounts.length, "regeneration does not create or delete accounts");
      assert.deepEqual(after.teams, positiveBefore.teams, "regeneration does not change team state");
      for (const row of after.accounts) {
        const id = (row as { id: string }).id;
        if (id !== positiveId) assert.deepEqual(row, positiveBefore.accounts.find((beforeRow) => (beforeRow as { id: string }).id === id), "only the eligible target password hash may change");
      }
    } finally {
      if (!setupReleased) setup.release();
    }
  });
});

test("PostgreSQL status transaction scopes by team and role while preserving account and history relations", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const setup = await pool.connect();
    let setupReleased = false;
    try {
      const account = async (name: string, role: "responsable" | "employe", teamId?: string) => (await setup.query<{ id: string }>(
        `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname)
         VALUES ($1, $2, $3, 'fixture-hash', false, $4, 'Nour', 'Ali') RETURNING id`,
        [`${name}-${randomUUID()}@example.test`, name, role, teamId ?? null],
      )).rows[0]!.id;
      const owner = await account("owner", "responsable");
      const otherOwner = await account("other-owner", "responsable");
      const ownerTeam = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [owner])).rows[0]!.id;
      const otherTeam = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [otherOwner])).rows[0]!.id;
      await setup.query("UPDATE identity_accounts SET team_id = $1 WHERE id = $2", [ownerTeam, owner]);
      await setup.query("UPDATE identity_accounts SET team_id = $1 WHERE id = $2", [otherTeam, otherOwner]);
      const ownEmployee = await account("own-employee", "employe", ownerTeam);
      const otherEmployee = await account("other-employee", "employe", otherTeam);
      await setup.query("CREATE TABLE retained_work (id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT)");
      await setup.query("INSERT INTO retained_work VALUES ($1, $2)", [randomUUID(), ownEmployee]);
      const servicePool = pool;
      setup.release(); setupReleased = true;

      const deactivated = await updateOwnTeamEmployeeStatus(servicePool, owner, ownEmployee, false);
      assert.equal(deactivated?.active, false);
      assert.equal(await updateOwnTeamEmployeeStatus(servicePool, owner, otherEmployee, false), undefined);
      assert.equal(await updateOwnTeamEmployeeStatus(servicePool, owner, owner, false), undefined);
      assert.equal((await servicePool.query<{ is_active: boolean }>("SELECT is_active FROM identity_accounts WHERE id = $1", [otherEmployee])).rows[0]?.is_active, true);
      const restored = await updateOwnTeamEmployeeStatus(servicePool, owner, ownEmployee, true);
      assert.equal(restored?.active, true);
      const retained = await servicePool.query("SELECT employee_id FROM retained_work WHERE employee_id = $1", [ownEmployee]);
      const accountCount = await servicePool.query<{ count: string }>("SELECT count(*)::text AS count FROM identity_accounts WHERE id = $1", [ownEmployee]);
      assert.equal(retained.rows.length, 1, "existing employee relations remain present");
      assert.equal(accountCount.rows[0]?.count, "1", "status change never deletes the employee account");
    } finally {
      if (!setupReleased) setup.release();
    }
  });
});
