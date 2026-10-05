import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import type { Pool, PoolClient } from "pg";
import { createApp } from "../index.js";
import { auditCommandTestSeams } from "../modules/audits/commands/audit-revisions.js";
import { createAssignedTask } from "../modules/tasks/tasks.js";
import { withPostgresTestSchema } from "./postgres.js";

// Test-only fixtures shared by the synchronization route suites (Stories 7.3 and 7.4); synthetic names only.

export type Kind = "draft-syncs" | "submissions";
export type Reply = { status: number; text: string; body: Record<string, unknown>; cacheControl: string | null };
export type SyncFixture = Awaited<ReturnType<typeof createFixture>>;

export const identity = () => ({ ...GRAPHIE_CALCULATION_IDENTITY });
export const formPayload = (values: Record<string, string> = { "header.reportNumber": "R-001" }) => ({ ...identity(), values });
export const envelope = (baseRevision: number, payload: unknown = formPayload(), overrides: Record<string, unknown> = {}) => ({
  operationId: randomUUID(),
  idempotencyKey: randomUUID(),
  baseRevision,
  localDraftRevision: 1,
  clientSavedAt: "2026-10-04T08:00:00.000Z",
  payload,
  ...overrides,
});

export async function account(client: PoolClient, role: "responsable" | "employe", name: string, teamId?: string) {
  const [firstName, surname = "Test"] = name.split(" ");
  const email = `${randomUUID()}@example.test`;
  const result = role === "responsable"
    ? await client.query<{ id: string }>(
      `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password)
       VALUES ($1, $2, $3, 'fixture-hash', false) RETURNING id`, [email, name, role],
    )
    : await client.query<{ id: string }>(
      `INSERT INTO identity_accounts (email, display_name, role, password_hash, must_change_password, team_id, first_name, surname)
       VALUES ($1, $2, $3, 'fixture-hash', false, $4, $5, $6) RETURNING id`,
      [email, name, role, teamId ?? null, firstName, surname],
    );
  return result.rows[0]!.id;
}

export async function addSession(pool: Pool, accountId: string) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await pool.query("INSERT INTO identity_sessions (account_id, token_hash, expires_at) VALUES ($1, $2, $3)", [accountId, hash, new Date(Date.now() + 3_600_000).toISOString()]);
  return token;
}

export async function counts(pool: Pool) {
  const result = await pool.query<{ audits: string; revisions: string; submissions: string; outcomes: string }>(
    `SELECT (SELECT count(*) FROM audits)::text AS audits, (SELECT count(*) FROM audit_revisions)::text AS revisions,
            (SELECT count(*) FROM audit_submissions)::text AS submissions, (SELECT count(*) FROM sync_operation_outcomes)::text AS outcomes`,
  );
  const row = result.rows[0]!;
  return { audits: Number(row.audits), revisions: Number(row.revisions), submissions: Number(row.submissions), outcomes: Number(row.outcomes) };
}

/**
 * Two teams, an assigned Employé (« Employé Test »), a second Employé with their own task, and the HTTP server.
 * `migrateThrough` stops the migrations at that version to reproduce a staged upgrade.
 */
export async function withSyncFixture(run: (fixture: SyncFixture) => Promise<void>, options: { migrateThrough?: string } = {}) {
  await withPostgresTestSchema(async ({ pool, migrate }) => {
    const fixture = await createFixture(pool, migrate, options.migrateThrough);
    try {
      await run(fixture);
    } finally {
      auditCommandTestSeams.afterRevisionInsert = undefined;
      auditCommandTestSeams.calculate = undefined;
      await fixture.close();
    }
  }, { migrateThrough: "0003_identity_sessions", maxConnections: 8 });
}

async function createFixture(pool: Pool, migrate: (options?: { through?: string }) => Promise<void>, migrateThrough?: string) {
  const setup = await pool.connect();
  let owner: string, otherOwner: string, employee: string, colleague: string, otherEmployee: string;
  try {
    owner = await account(setup, "responsable", "Responsable Test");
    otherOwner = await account(setup, "responsable", "Responsable Autre");
    await migrate({ through: migrateThrough });
    const teams = await setup.query<{ id: string; responsable_account_id: string }>("SELECT id, responsable_account_id FROM identity_teams");
    const team = teams.rows.find((row) => row.responsable_account_id === owner)!.id;
    const otherTeam = teams.rows.find((row) => row.responsable_account_id === otherOwner)!.id;
    employee = await account(setup, "employe", "Employé Test", team);
    colleague = await account(setup, "employe", "Collègue Test", team);
    otherEmployee = await account(setup, "employe", "Employé Autre", otherTeam);
  } finally {
    setup.release();
  }
  const newTask = (assigneeId: string, responsable = owner) => createAssignedTask(pool, responsable, { establishment: "Établissement A", service: "Radiologie", type: "graphie_mobile", assigneeId }).then((task) => task.id);
  const tokens = {
    employee: await addSession(pool, employee),
    colleague: await addSession(pool, colleague),
    otherEmployee: await addSession(pool, otherEmployee),
    owner: await addSession(pool, owner),
    otherOwner: await addSession(pool, otherOwner),
  };
  const server = createServer(createApp(pool));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const root = `${apiRoot}/employee/tasks`;
  /** `token: null` sends no Authorization header. */
  const send = async (kind: Kind, taskId: string, body: unknown, token: string | null = tokens.employee): Promise<Reply> => {
    const response = await fetch(`${root}/${taskId}/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: response.headers.get("cache-control") };
  };
  return {
    pool, owner, otherOwner, employee, colleague, otherEmployee, tokens, newTask, send, apiRoot,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
