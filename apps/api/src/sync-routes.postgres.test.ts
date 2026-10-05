import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { calculateGraphieResults, GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import type { Pool, PoolClient } from "pg";
import { createApp } from "./index.js";
import { auditCommandTestSeams } from "./modules/audits/commands/audit-revisions.js";
import { createAssignedTask } from "./modules/tasks/tasks.js";
import { withPostgresTestSchema } from "./test-support/postgres.js";

type Kind = "draft-syncs" | "submissions";
type Reply = { status: number; text: string; body: Record<string, unknown>; cacheControl: string | null };

const identity = () => ({ ...GRAPHIE_CALCULATION_IDENTITY });
const formPayload = (values: Record<string, string> = { "header.reportNumber": "R-001" }) => ({ ...identity(), values });
const envelope = (baseRevision: number, payload: unknown = formPayload(), overrides: Record<string, unknown> = {}) => ({
  operationId: randomUUID(),
  idempotencyKey: randomUUID(),
  baseRevision,
  localDraftRevision: 1,
  clientSavedAt: "2026-10-04T08:00:00.000Z",
  payload,
  ...overrides,
});

async function account(client: PoolClient, role: "responsable" | "employe", name: string, teamId?: string) {
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

async function addSession(pool: Pool, accountId: string) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await pool.query("INSERT INTO identity_sessions (account_id, token_hash, expires_at) VALUES ($1, $2, $3)", [accountId, hash, new Date(Date.now() + 3_600_000).toISOString()]);
  return token;
}

async function counts(pool: Pool) {
  const result = await pool.query<{ audits: string; revisions: string; submissions: string; outcomes: string }>(
    `SELECT (SELECT count(*) FROM audits)::text AS audits, (SELECT count(*) FROM audit_revisions)::text AS revisions,
            (SELECT count(*) FROM audit_submissions)::text AS submissions, (SELECT count(*) FROM sync_operation_outcomes)::text AS outcomes`,
  );
  const row = result.rows[0]!;
  return { audits: Number(row.audits), revisions: Number(row.revisions), submissions: Number(row.submissions), outcomes: Number(row.outcomes) };
}

/** Two teams, an assigned Employé (« Employé Test »), a second Employé with their own task, and the HTTP server. */
async function withSyncFixture(run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>) {
  await withPostgresTestSchema(async ({ pool, migrate }) => {
    const fixture = await createFixture(pool, migrate);
    try {
      await run(fixture);
    } finally {
      auditCommandTestSeams.afterRevisionInsert = undefined;
      auditCommandTestSeams.calculate = undefined;
      await fixture.close();
    }
  }, { migrateThrough: "0003_identity_sessions", maxConnections: 8 });
}

async function createFixture(pool: Pool, migrate: () => Promise<void>) {
  const setup = await pool.connect();
  let owner: string, otherOwner: string, employee: string, colleague: string, otherEmployee: string;
  try {
    owner = await account(setup, "responsable", "Responsable Test");
    otherOwner = await account(setup, "responsable", "Responsable Autre");
    await migrate();
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

test("A1 a valid submission on a task without audit is accepted once with the session actor and the server date", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    const request = envelope(0, formPayload(), { localDraftRevision: 4 });
    const before = Date.now();
    const reply = await send("submissions", taskId, request);
    assert.equal(reply.status, 200);
    assert.match(reply.cacheControl ?? "", /no-store/i);
    assert.deepEqual(Object.keys(reply.body).sort(), ["acceptedAt", "acceptedBy", "kind", "operationId", "outcome", "serverRevision", "submissionId"]);
    assert.equal(reply.body.outcome, "accepted");
    assert.equal(reply.body.kind, "submit");
    assert.equal(reply.body.operationId, request.operationId);
    assert.equal(reply.body.serverRevision, 1);
    assert.deepEqual(reply.body.acceptedBy, { id: employee, displayName: "Employé Test" });
    const acceptedAt = Date.parse(String(reply.body.acceptedAt));
    assert.ok(acceptedAt >= before - 5_000 && acceptedAt <= Date.now() + 5_000, "acceptedAt is the server date, not the client savedAt");
    assert.deepEqual(await counts(pool), { audits: 1, revisions: 1, submissions: 1, outcomes: 1 });
    const audit = (await pool.query("SELECT task_id, state, current_revision, updated_by FROM audits")).rows[0];
    assert.deepEqual(audit, { task_id: taskId, state: "submitted", current_revision: 1, updated_by: employee });
    const revision = (await pool.query("SELECT kind, revision, actor_id, local_draft_revision, client_saved_at, payload FROM audit_revisions")).rows[0];
    assert.deepEqual({ ...revision, client_saved_at: revision.client_saved_at.toISOString() }, {
      kind: "submission", revision: 1, actor_id: employee, local_draft_revision: 4, client_saved_at: "2026-10-04T08:00:00.000Z", payload: formPayload(),
    });
    const submission = (await pool.query("SELECT id, submitted_by, accepted_at, operation_id, revision FROM audit_submissions")).rows[0];
    assert.deepEqual({ ...submission, accepted_at: submission.accepted_at.toISOString() }, {
      id: reply.body.submissionId, submitted_by: employee, accepted_at: reply.body.acceptedAt, operation_id: request.operationId, revision: 1,
    });
    const outcome = (await pool.query("SELECT actor_id, task_id, kind, outcome, http_status FROM sync_operation_outcomes")).rows[0];
    assert.deepEqual(outcome, { actor_id: employee, task_id: taskId, kind: "submit", outcome: "accepted", http_status: 200 });
  });
});

test("A2 draft synchronizations then a submission add revisions 1, 2 and 3", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    const first = await send("draft-syncs", taskId, envelope(0));
    assert.equal(first.status, 200);
    assert.equal(first.body.kind, "sync-draft");
    assert.equal("submissionId" in first.body, false);
    assert.equal((await send("draft-syncs", taskId, envelope(1, formPayload({ "header.reportNumber": "R-002" })))).body.serverRevision, 2);
    const submitted = await send("submissions", taskId, envelope(2));
    assert.equal(submitted.body.serverRevision, 3);
    const revisions = (await pool.query("SELECT revision, kind, results IS NULL AS no_results FROM audit_revisions ORDER BY revision")).rows;
    assert.deepEqual(revisions, [
      { revision: 1, kind: "draft-sync", no_results: true },
      { revision: 2, kind: "draft-sync", no_results: true },
      { revision: 3, kind: "submission", no_results: false },
    ]);
    assert.deepEqual((await pool.query("SELECT state, current_revision FROM audits")).rows, [{ state: "submitted", current_revision: 3 }]);
    assert.deepEqual(await counts(pool), { audits: 1, revisions: 3, submissions: 1, outcomes: 3 });
  });
});

test("A3 a replay with the same key and body returns the stored response byte-equal and writes nothing", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    const request = envelope(0);
    const first = await send("submissions", taskId, request);
    const before = await counts(pool);
    const replay = await send("submissions", taskId, request);
    assert.equal(replay.status, first.status);
    assert.equal(replay.text, first.text);
    assert.deepEqual(await counts(pool), before);
  });
});

test("A3 a replay with upper-case operation ID and key is still recognised as the same request", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    const request = envelope(0, formPayload(), { operationId: randomUUID().toUpperCase(), idempotencyKey: randomUUID().toUpperCase() });
    const first = await send("draft-syncs", taskId, request);
    assert.equal(first.status, 200);
    const before = await counts(pool);
    const replay = await send("draft-syncs", taskId, request);
    assert.deepEqual([replay.status, replay.text], [200, first.text]);
    assert.deepEqual(await counts(pool), before);
  });
});

test("A4 two concurrent identical requests produce one revision and two equal responses", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    const request = envelope(0);
    const [first, second] = await Promise.all([send("submissions", taskId, request), send("submissions", taskId, request)]);
    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.equal(first.text, second.text);
    assert.deepEqual(await counts(pool), { audits: 1, revisions: 1, submissions: 1, outcomes: 1 });
  });
});

test("A5 two concurrent operations with different keys on the same base give one acceptance and one conflict", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    const replies = await Promise.all([send("draft-syncs", taskId, envelope(0)), send("draft-syncs", taskId, envelope(0))]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
    assert.deepEqual(await counts(pool), { audits: 1, revisions: 1, submissions: 0, outcomes: 2 });
  });
});

test("A6 a reused key or operation ID with another request or actor is refused without disclosing the stored outcome", async () => {
  await withSyncFixture(async ({ pool, employee, otherEmployee, otherOwner, tokens, newTask, send }) => {
    const taskId = await newTask(employee);
    const otherTask = await newTask(otherEmployee, otherOwner);
    const request = envelope(0);
    assert.equal((await send("draft-syncs", taskId, request)).status, 200);
    const before = await counts(pool);
    const attempts = [
      await send("draft-syncs", taskId, { ...request, payload: formPayload({ "header.reportNumber": "autre" }) }),
      await send("submissions", taskId, request),
      await send("draft-syncs", otherTask, request, tokens.otherEmployee),
      await send("draft-syncs", taskId, { ...request, idempotencyKey: randomUUID() }),
      await send("draft-syncs", taskId, { ...request, operationId: randomUUID() }),
    ];
    for (const reply of attempts) {
      assert.equal(reply.status, 422);
      assert.deepEqual(reply.body, { error: { code: "IDEMPOTENCY_KEY_REUSED", message: "Cette clé d’opération a déjà été utilisée pour une autre requête." } });
      assert.equal(reply.text.includes("serverRevision"), false);
    }
    assert.deepEqual(await counts(pool), before);
  });
});

test("A6 the same key sent concurrently on two tasks is accepted once and refused once, never a server error", async () => {
  await withSyncFixture(async ({ pool, employee, otherEmployee, otherOwner, tokens, newTask, send }) => {
    const taskId = await newTask(employee);
    const otherTask = await newTask(otherEmployee, otherOwner);
    // Holds the first acceptance open so the second request meets its uncommitted rows (unique-violation retry path).
    auditCommandTestSeams.afterRevisionInsert = () => new Promise((resolve) => setTimeout(resolve, 300));
    const request = envelope(0);
    const replies = await Promise.all([send("draft-syncs", taskId, request), send("draft-syncs", otherTask, request, tokens.otherEmployee)]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 422]);
    const refused = replies.find((reply) => reply.status === 422)!;
    assert.deepEqual(refused.body, { error: { code: "IDEMPOTENCY_KEY_REUSED", message: "Cette clé d’opération a déjà été utilisée pour une autre requête." } });
    assert.deepEqual(await counts(pool), { audits: 1, revisions: 1, submissions: 0, outcomes: 1 });
  });
});

test("A7 a stale base revision returns the current version metadata, writes only the outcome and replays it", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    await send("draft-syncs", taskId, envelope(0));
    const second = await send("draft-syncs", taskId, envelope(1));
    const before = await counts(pool);
    const stale = envelope(0);
    const conflict = await send("submissions", taskId, stale);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body, {
      outcome: "conflict", operationId: stale.operationId, kind: "submit", serverRevision: 2,
      current: { revision: 2, state: "draft", lastChangedAt: second.body.acceptedAt, lastChangedBy: { id: employee, displayName: "Employé Test" } },
    });
    assert.deepEqual(await counts(pool), { ...before, outcomes: before.outcomes + 1 });
    const replay = await send("submissions", taskId, stale);
    assert.deepEqual([replay.status, replay.text], [409, conflict.text]);
    assert.deepEqual(await counts(pool), { ...before, outcomes: before.outcomes + 1 });

    const fresh = await newTask(employee);
    const ahead = await send("draft-syncs", fresh, envelope(3));
    assert.equal(ahead.status, 409);
    assert.deepEqual(ahead.body.current, { revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audits WHERE task_id = $1", [fresh])).rows[0].count, 0);
  });
});

test("A8 each structural validation failure is a stored 422 rejection that changes no audit data", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const cases: Array<[Kind, unknown, string]> = [
      ["submissions", { content: "ancien contenu" }, "UNSUPPORTED_PAYLOAD"],
      ["submissions", { ...formPayload(), ruleVersion: "1.0.0" }, "UNSUPPORTED_PAYLOAD_VERSION"],
      ["draft-syncs", formPayload({ "future.field": "x" }), "INVALID_PAYLOAD"],
      ["submissions", formPayload({ "header.reportNumber": "a\u0000b" }), "INVALID_PAYLOAD"],
      ["draft-syncs", formPayload({ "visual.integrity": "Conforme" }), "INVALID_PAYLOAD"],
      ["submissions", { ...formPayload(), legacyContent: "ancien" }, "INVALID_PAYLOAD"],
      ["draft-syncs", formPayload({ "inconnu\u0000": "x" }), "INVALID_PAYLOAD"],
    ];
    for (const [kind, payload, code] of cases) {
      const taskId = await newTask(employee);
      const request = envelope(0, payload);
      const reply = await send(kind, taskId, request);
      assert.equal(reply.status, 422, code);
      assert.equal(reply.body.outcome, "rejected");
      assert.equal(reply.body.code, code);
      assert.ok(Array.isArray(reply.body.issues) && reply.body.issues.length > 0);
      assert.equal(reply.text.includes("ancien contenu"), false, "no payload value in the body");
      const replay = await send(kind, taskId, request);
      assert.deepEqual([replay.status, replay.text], [422, reply.text]);
    }
    assert.deepEqual(await counts(pool), { audits: 0, revisions: 0, submissions: 0, outcomes: cases.length });
  });
});

test("A9 / D1 blank fields and unparseable readings are accepted unchanged; no business validation exists (DEP-01/02)", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    const values = { "header.reportNumber": "", "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "abc", "voltage.accuracy.row2.kvMeasured": "", "visual.integrity": "" };
    const reply = await send("submissions", taskId, envelope(0, formPayload(values)));
    assert.equal(reply.status, 200);
    const revision = (await pool.query("SELECT payload, results FROM audit_revisions")).rows[0];
    assert.deepEqual(revision.payload, formPayload(values));
    const serialized = JSON.stringify(revision.results);
    assert.ok(serialized.includes("\"invalid-input\""));
    assert.ok(serialized.includes("\"missing-input\""));
  });
});

test("A10 any operation after an accepted submission is rejected and the single submission stays", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    assert.equal((await send("submissions", taskId, envelope(0))).status, 200);
    for (const kind of ["draft-syncs", "submissions"] as const) {
      const reply = await send(kind, taskId, envelope(1));
      assert.equal(reply.status, 422);
      assert.deepEqual([reply.body.outcome, reply.body.code, reply.body.message], ["rejected", "AUDIT_ALREADY_SUBMITTED", "Ce contrôle a déjà été soumis et accepté."]);
    }
    assert.deepEqual(await counts(pool), { audits: 1, revisions: 1, submissions: 1, outcomes: 3 });
  });
});

test("A11 sessions, roles and assignment are checked before anything is written or disclosed", async () => {
  await withSyncFixture(async ({ pool, employee, colleague, tokens, newTask, send }) => {
    const taskId = await newTask(employee);
    const colleagueTask = await newTask(colleague);
    const request = envelope(0);
    assert.equal((await send("submissions", taskId, request, null)).status, 401);
    assert.equal((await send("submissions", taskId, request, "x".repeat(43))).status, 401);
    const forbidden = await send("submissions", taskId, request, tokens.owner);
    assert.deepEqual([forbidden.status, forbidden.body], [403, { error: { code: "FORBIDDEN", message: "Accès réservé à l’Employé." } }]);
    const notAssigned = await send("submissions", colleagueTask, request);
    const unknown = await send("submissions", randomUUID(), request);
    const notUuid = await send("submissions", "not-a-task", request);
    for (const reply of [notAssigned, unknown, notUuid]) {
      assert.equal(reply.status, 404);
      assert.deepEqual(reply.body, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } });
    }
    assert.equal(notAssigned.text.includes("Établissement"), false);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
    assert.equal((await send("submissions", taskId, request)).status, 401);
    assert.deepEqual(await counts(pool), { audits: 0, revisions: 0, submissions: 0, outcomes: 0 });
  });
});

test("A12 a malformed envelope is a 400 and an oversized body a 413; neither is stored", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    for (const body of [
      { ...envelope(0), employeeId: employee },
      { ...envelope(0), operationId: "op-1" },
      { ...envelope(0), baseRevision: -1 },
      { ...envelope(0), payload: "texte" },
    ]) {
      const reply = await send("draft-syncs", taskId, body);
      assert.equal(reply.status, 400, JSON.stringify(body));
      assert.equal((reply.body.error as { code: string }).code, "VALIDATION_ERROR");
    }
    const secret = "valeur-secrète";
    const leaked = await send("draft-syncs", taskId, { ...envelope(0, { ...formPayload({ "header.reportNumber": secret }) }), extra: secret });
    assert.equal(leaked.text.includes(secret), false);
    const large = await send("draft-syncs", taskId, envelope(0, formPayload({ "comments.general": "x".repeat(300_000) })));
    assert.deepEqual([large.status, large.body], [413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Les données envoyées sont trop volumineuses." } }]);
    const withinLimit = await send("draft-syncs", taskId, envelope(0, formPayload({ "comments.general": "x".repeat(100_000) })));
    assert.equal(withinLimit.status, 200, "sync routes accept bodies above the 32 kB default");
    assert.deepEqual(await counts(pool), { audits: 1, revisions: 1, submissions: 0, outcomes: 1 });
  });
});

test("A12 the 256 kB limit covers the submission route and only the two sync routes", async () => {
  await withSyncFixture(async ({ pool, employee, tokens, newTask, send, apiRoot }) => {
    const submitted = await send("submissions", await newTask(employee), envelope(0, formPayload({ "comments.general": "x".repeat(100_000) })));
    assert.equal(submitted.status, 200, "submissions accept bodies above the 32 kB default");
    // Express matches routes case-insensitively; such a path reaches the sync route and gets its limit too.
    const mixedCase = await fetch(`${apiRoot}/Employee/Tasks/${await newTask(employee)}/Draft-Syncs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.employee}` },
      body: JSON.stringify(envelope(0, formPayload({ "comments.general": "x".repeat(100_000) }))),
    });
    assert.equal(mixedCase.status, 200);
    // Every other route keeps the 32 kB default.
    const otherRoute = await fetch(`${apiRoot}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.owner}` },
      body: JSON.stringify({ establishment: "Établissement A", service: "x".repeat(40_000), type: "graphie_mobile", assigneeId: employee }),
    });
    assert.deepEqual([otherRoute.status, await otherRoute.json()], [413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Les données envoyées sont trop volumineuses." } }]);
    assert.deepEqual(await counts(pool), { audits: 2, revisions: 2, submissions: 1, outcomes: 2 });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM tasks")).rows[0].count, 2);
  });
});

test("A13 a failure injected after the revision insert rolls every write back", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    auditCommandTestSeams.afterRevisionInsert = () => { throw new Error("injected failure"); };
    for (const kind of ["draft-syncs", "submissions"] as const) {
      const reply = await send(kind, taskId, envelope(0));
      assert.deepEqual([reply.status, reply.body], [500, { error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }]);
    }
    assert.deepEqual(await counts(pool), { audits: 0, revisions: 0, submissions: 0, outcomes: 0 });
    auditCommandTestSeams.afterRevisionInsert = undefined;
    assert.equal((await send("submissions", taskId, envelope(0))).status, 200);
  });
});

test("A14 stored results are the domain results for the stored identity; an identity mismatch writes nothing", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const values = {
      "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2",
      "voltage.repeatability.row1.kvMeasured": "70", "voltage.repeatability.row2.kvMeasured": "70,4",
      "voltage.repeatability.row1.kerma": "1,2", "voltage.repeatability.row2.kerma": "1,25",
      "lightField.dfr": "1", "lightField.gap1": "5",
    };
    const taskId = await newTask(employee);
    assert.equal((await send("submissions", taskId, envelope(0, formPayload(values)))).status, 200);
    const revision = (await pool.query("SELECT catalogue_id, catalogue_version, schema_version, rule_id, rule_version, results FROM audit_revisions")).rows[0];
    assert.deepEqual(revision.results, JSON.parse(JSON.stringify(calculateGraphieResults(identity(), values))));
    for (const result of Object.values(revision.results as Record<string, Record<string, unknown>>)) {
      assert.deepEqual(
        [result.catalogueId, result.catalogueVersion, result.schemaVersion, result.ruleId, result.ruleVersion],
        [revision.catalogue_id, revision.catalogue_version, revision.schema_version, revision.rule_id, revision.rule_version],
      );
    }

    const before = await counts(pool);
    auditCommandTestSeams.calculate = (context, input) => {
      const results = calculateGraphieResults(context, input);
      return { ...results, outputLinearity: { ...results.outputLinearity, ruleVersion: "1.0.0" } } as typeof results;
    };
    const mismatch = await send("submissions", await newTask(employee), envelope(0, formPayload(values)));
    assert.equal(mismatch.status, 500);
    assert.deepEqual(await counts(pool), before);
  });
});

test("A15 revisions, submissions and stored outcomes are insert-only", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    await send("submissions", await newTask(employee), envelope(0));
    for (const statement of [
      "UPDATE audit_revisions SET local_draft_revision = 9",
      "DELETE FROM audit_revisions",
      "UPDATE audit_submissions SET accepted_at = now()",
      "DELETE FROM audit_submissions",
      "UPDATE sync_operation_outcomes SET http_status = 422",
      "DELETE FROM sync_operation_outcomes",
    ]) await assert.rejects(pool.query(statement), /insert-only/, statement);
    assert.deepEqual(await counts(pool), { audits: 1, revisions: 1, submissions: 1, outcomes: 1 });
  });
});

test("A16 migrating 0008 to 0009 keeps existing tasks and adds the tables and history triggers", async () => {
  await withPostgresTestSchema(async ({ pool, migrate }) => {
    const setup = await pool.connect();
    try {
      const owner = await account(setup, "responsable", "Responsable Test");
      const team = (await setup.query<{ id: string }>("INSERT INTO identity_teams (responsable_account_id) VALUES ($1) RETURNING id", [owner])).rows[0]!.id;
      const employee = await account(setup, "employe", "Employé Test", team);
      const task = await createAssignedTask(pool, owner, { establishment: "Établissement A", service: "Radiologie", type: "graphie_mobile", assigneeId: employee });
      const before = (await setup.query("SELECT * FROM tasks ORDER BY id")).rows;
      const assignments = (await setup.query("SELECT * FROM task_assignments ORDER BY task_id")).rows;
      await migrate();
      assert.deepEqual((await setup.query("SELECT * FROM tasks ORDER BY id")).rows, before);
      assert.deepEqual((await setup.query("SELECT * FROM task_assignments ORDER BY task_id")).rows, assignments);
      assert.equal(before[0].id, task.id);
      const tables = (await setup.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('audits', 'audit_revisions', 'audit_submissions', 'sync_operation_outcomes') ORDER BY table_name",
      )).rows.map((row) => row.table_name);
      assert.deepEqual(tables, ["audit_revisions", "audit_submissions", "audits", "sync_operation_outcomes"]);
      const triggers = (await setup.query<{ trigger_name: string }>(
        "SELECT DISTINCT trigger_name FROM information_schema.triggers WHERE trigger_schema = current_schema() AND trigger_name LIKE '%insert_only' ORDER BY trigger_name",
      )).rows.map((row) => row.trigger_name);
      assert.deepEqual(triggers, ["audit_revisions_insert_only", "audit_submissions_insert_only", "sync_operation_outcomes_insert_only"]);
    } finally {
      setup.release();
    }
  }, { migrateThrough: "0008_identity_password_resets" });
});
