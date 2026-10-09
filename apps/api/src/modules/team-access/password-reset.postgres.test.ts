import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { resetOwnTeamEmployeePassword, updateOwnTeamEmployeeStatus } from "./employee-credentials.js";
import { authenticateWithPassword, hashPassword, verifyPassword } from "../identity-auth/index.js";
import { withPostgresTestSchema } from "../../test-support/postgres.js";

const previousPassword = "previous-employee-password";

async function seedTeams(pool: Pool) {
  const passwordHash = await hashPassword(previousPassword);
  const account = async (name: string, role: "responsable" | "employe", options: { teamId?: string; active?: boolean; mustChange?: boolean } = {}) => {
    const email = `${name}-${randomUUID()}@example.test`;
    const id = (await pool.query<{ id: string }>(
      `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, is_active, team_id, first_name, surname)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Test', $8) RETURNING id`,
      [email, `Story 2.4 ${name}`, role, passwordHash, options.mustChange ?? false, options.active ?? true, options.teamId ?? null, name],
    )).rows[0]!.id;
    return { id, email };
  };
  const owner = await account("owner", "responsable");
  const otherOwner = await account("other-owner", "responsable");
  const ownTeam = (await pool.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [owner.id])).rows[0]!.id;
  const otherTeam = (await pool.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [otherOwner.id])).rows[0]!.id;
  return { owner, otherOwner, ownTeam, otherTeam, account };
}

async function snapshot(pool: Pool) {
  const accounts = await pool.query("SELECT id, password_hash, must_change_password, is_active FROM identity_accounts ORDER BY id");
  const sessions = await pool.query("SELECT id, account_id, revoked_at FROM identity_sessions ORDER BY id");
  const resets = await pool.query("SELECT * FROM identity_password_resets ORDER BY id");
  return { accounts: accounts.rows, sessions: sessions.rows, resets: resets.rows };
}

async function openSession(pool: Pool, email: string) {
  await pool.query(
    `INSERT INTO identity_sessions (account_id, token_hash, expires_at)
     SELECT id, $2, now() + interval '8 hours' FROM identity_accounts WHERE email = $1`,
    [email, randomUUID()],
  );
}

async function assertResetApplied(pool: Pool, ownerId: string, employeeId: string, oldPassword: string) {
  const result = await resetOwnTeamEmployeePassword(pool, ownerId, employeeId);
  assert.equal(result.outcome, "reset");
  if (result.outcome !== "reset") return;
  assert.equal(result.employee.id, employeeId);
  assert.match(result.temporaryCredential, /^[A-Za-z0-9!@#$%*?]{8}$/);
  const row = (await pool.query<{ password_hash: string; must_change_password: boolean }>(
    "SELECT password_hash, must_change_password FROM identity_accounts WHERE id = $1", [employeeId],
  )).rows[0]!;
  assert.equal(await verifyPassword(oldPassword, row.password_hash), false, "the old password stops working");
  assert.equal(await verifyPassword(result.temporaryCredential, row.password_hash), true);
  assert.equal(row.must_change_password, true);
  const openSessions = await pool.query("SELECT 1 FROM identity_sessions WHERE account_id = $1 AND revoked_at IS NULL", [employeeId]);
  assert.equal(openSessions.rowCount, 0, "every prior session is revoked");
  const audit = await pool.query<{ account_id: string; reset_by_account_id: string; channel: string }>(
    "SELECT account_id, reset_by_account_id, channel FROM identity_password_resets WHERE account_id = $1", [employeeId],
  );
  assert.deepEqual(audit.rows, [{ account_id: employeeId, reset_by_account_id: ownerId, channel: "responsable" }]);
  return result.temporaryCredential;
}

test("R1 an activated own-team Employé is reset: new credential, forced change, sessions revoked, one audit row", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const { owner, ownTeam, account } = await seedTeams(pool);
    const employee = await account("activated", "employe", { teamId: ownTeam });
    await openSession(pool, employee.email);
    await openSession(pool, employee.email);
    await openSession(pool, owner.email);
    const credential = await assertResetApplied(pool, owner.id, employee.id, previousPassword);
    const signedIn = await authenticateWithPassword(pool, employee.email, credential!);
    assert.equal(signedIn.mustChangePassword, true, "the temporary credential gives an activation-only session");
    const ownerOpen = await pool.query("SELECT revoked_at FROM identity_sessions WHERE account_id = $1", [owner.id]);
    assert.equal(ownerOpen.rows.length, 1);
    assert.equal(ownerOpen.rows[0]!.revoked_at, null, "the Responsable's own session is untouched");
  });
});

test("R2 a not-yet-activated Employé is reset and the previous temporary credential no longer verifies", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const { owner, ownTeam, account } = await seedTeams(pool);
    const employee = await account("pending", "employe", { teamId: ownTeam, mustChange: true });
    await openSession(pool, employee.email);
    await assertResetApplied(pool, owner.id, employee.id, previousPassword);
  });
});

test("R3 a deactivated own-team Employé is refused as inactive without any mutation", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const { owner, ownTeam, account } = await seedTeams(pool);
    const employee = await account("inactive", "employe", { teamId: ownTeam });
    await openSession(pool, employee.email);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee.id]);
    const before = await snapshot(pool);
    assert.deepEqual(await resetOwnTeamEmployeePassword(pool, owner.id, employee.id), { outcome: "inactive" });
    assert.deepEqual(await snapshot(pool), before);
  });
});

test("R4 another team's Employé, a Responsable id, the caller's own id and an unknown id are not found and unchanged", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const { owner, otherOwner, ownTeam, otherTeam, account } = await seedTeams(pool);
    const otherEmployee = await account("other-team", "employe", { teamId: otherTeam });
    const teamResponsable = await account("wrong-role", "responsable", { teamId: ownTeam });
    await openSession(pool, otherEmployee.email);
    await openSession(pool, owner.email);
    for (const [label, id] of [["other team", otherEmployee.id], ["Responsable role", teamResponsable.id], ["other Responsable", otherOwner.id], ["own id", owner.id], ["unknown", randomUUID()]] as const) {
      const before = await snapshot(pool);
      assert.deepEqual(await resetOwnTeamEmployeePassword(pool, owner.id, id), { outcome: "not_found" }, label);
      assert.deepEqual(await snapshot(pool), before, `${label} must not change any state`);
    }
  });
});

test("R5 an audit insert failure rolls back the hash, flag and session revocation", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const { owner, ownTeam, account } = await seedTeams(pool);
    const employee = await account("rollback", "employe", { teamId: ownTeam });
    await openSession(pool, employee.email);
    await pool.query(`CREATE FUNCTION fail_password_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced audit failure'; END $$`);
    await pool.query("CREATE TRIGGER fail_password_reset_audit BEFORE INSERT ON identity_password_resets FOR EACH ROW EXECUTE FUNCTION fail_password_reset_audit()");
    const before = await snapshot(pool);
    await assert.rejects(resetOwnTeamEmployeePassword(pool, owner.id, employee.id), /forced audit failure/);
    assert.deepEqual(await snapshot(pool), before);
    const stillWorks = await authenticateWithPassword(pool, employee.email, previousPassword);
    assert.equal(stillWorks.mustChangePassword, false);
  });
});

test("R6 a concurrent reset and deactivation leave a consistent final state", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const { owner, ownTeam, account } = await seedTeams(pool);
    for (let attempt = 0; attempt < 5; attempt++) {
      const employee = await account(`race-${attempt}`, "employe", { teamId: ownTeam });
      const [reset, deactivated] = await Promise.all([
        resetOwnTeamEmployeePassword(pool, owner.id, employee.id),
        updateOwnTeamEmployeeStatus(pool, owner.id, employee.id, false),
      ]);
      assert.equal(deactivated?.active, false);
      const row = (await pool.query<{ password_hash: string; must_change_password: boolean; is_active: boolean }>(
        "SELECT password_hash, must_change_password, is_active FROM identity_accounts WHERE id = $1", [employee.id],
      )).rows[0]!;
      const audits = (await pool.query("SELECT 1 FROM identity_password_resets WHERE account_id = $1", [employee.id])).rowCount;
      assert.equal(row.is_active, false);
      if (reset.outcome === "reset") {
        assert.equal(audits, 1);
        assert.equal(row.must_change_password, true);
        assert.equal(await verifyPassword(reset.temporaryCredential, row.password_hash), true);
      } else {
        assert.equal(reset.outcome, "inactive");
        assert.equal(audits, 0);
        assert.equal(row.must_change_password, false);
        assert.equal(await verifyPassword(previousPassword, row.password_hash), true);
      }
    }
  });
});

test("R7 migration 0008 creates the audit table and its actor/channel CHECK", async () => {
  await withPostgresTestSchema(async ({ pool }) => {
    const { owner, ownTeam, account } = await seedTeams(pool);
    const employee = await account("audit", "employe", { teamId: ownTeam });
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'identity_password_resets' ORDER BY ordinal_position",
    );
    assert.deepEqual(columns.rows.map((row) => row.column_name), ["id", "account_id", "reset_by_account_id", "channel", "created_at"]);
    await assert.rejects(
      pool.query("INSERT INTO identity_password_resets (account_id, reset_by_account_id, channel) VALUES ($1, NULL, 'responsable')", [employee.id]),
      { code: "23514" },
    );
    await assert.rejects(
      pool.query("INSERT INTO identity_password_resets (account_id, reset_by_account_id, channel) VALUES ($1, $2, 'operator')", [owner.id, owner.id]),
      { code: "23514" },
    );
    await assert.rejects(
      pool.query("INSERT INTO identity_password_resets (account_id, reset_by_account_id, channel) VALUES ($1, NULL, 'email')", [owner.id]),
      { code: "23514" },
    );
    await pool.query("INSERT INTO identity_password_resets (account_id, reset_by_account_id, channel) VALUES ($1, $2, 'responsable')", [employee.id, owner.id]);
    await pool.query("INSERT INTO identity_password_resets (account_id, reset_by_account_id, channel) VALUES ($1, NULL, 'operator')", [owner.id]);
  });
});
