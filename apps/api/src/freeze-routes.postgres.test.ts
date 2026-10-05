import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { calculateGraphieResults } from "@cetem-qc/domain";
import type { Pool } from "pg";
import { migrate } from "./db/migrate.js";
import { createApp } from "./index.js";
import { getAcceptedSubmissionForReview } from "./modules/audits/queries/accepted-submission.js";
import { getOwnTeamTaskId } from "./modules/tasks/queries/own-team-task.js";
import { counts, envelope, formPayload, identity, withSyncFixture } from "./test-support/sync-fixture.js";
import type { Kind, SyncFixture } from "./test-support/sync-fixture.js";

// Story 7.4: accepted measurements and comments stay frozen for both roles, the API and direct SQL.

const acceptedValues = {
  "header.reportNumber": "R-074",
  "voltage.accuracy.row1.kvDisplayed": "50",
  "voltage.accuracy.row1.kvMeasured": "49,2",
  "comments.general": "Commentaire d’origine",
};
const changedValues = { ...acceptedValues, "voltage.accuracy.row1.kvMeasured": "55", "comments.general": "Commentaire modifié" };

/**
 * Every evidence row of one task, serialized by PostgreSQL itself (timestamps keep their microseconds).
 * `outcomeKeys` limits the stored outcomes to those keys, to ignore outcomes added by a refused attempt.
 */
async function evidenceFingerprint(pool: Pool, taskId: string, outcomeKeys?: string[]): Promise<string> {
  const result = await pool.query<{ fingerprint: string }>(
    `SELECT jsonb_build_object(
       'task', (SELECT to_jsonb(task) FROM tasks task WHERE task.id = $1),
       'audit', (SELECT to_jsonb(audit) FROM audits audit WHERE audit.task_id = $1),
       'revisions', (SELECT coalesce(jsonb_agg(to_jsonb(revision) ORDER BY revision.revision), '[]'::jsonb)
                     FROM audit_revisions revision JOIN audits audit ON audit.id = revision.audit_id WHERE audit.task_id = $1),
       'submission', (SELECT to_jsonb(submission) FROM audit_submissions submission
                      JOIN audits audit ON audit.id = submission.audit_id WHERE audit.task_id = $1),
       'outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(outcome) ORDER BY outcome.idempotency_key), '[]'::jsonb)
                    FROM sync_operation_outcomes outcome
                    WHERE outcome.task_id = $1 AND ($2::uuid[] IS NULL OR outcome.idempotency_key = ANY($2::uuid[])))
     )::text AS fingerprint`,
    [taskId, outcomeKeys ?? null],
  );
  return result.rows[0]!.fingerprint;
}

async function outcomeKeys(pool: Pool, taskId: string) {
  const result = await pool.query<{ idempotency_key: string }>("SELECT idempotency_key FROM sync_operation_outcomes WHERE task_id = $1", [taskId]);
  return result.rows.map((row) => row.idempotency_key);
}

/** A task with one accepted draft-sync (revision 1) then an accepted submission (revision 2) carrying measurements and a comment. */
async function acceptedTask(fixture: SyncFixture) {
  const taskId = await fixture.newTask(fixture.employee);
  const draft = envelope(0, formPayload({ "header.reportNumber": "R-074" }));
  const draftReply = await fixture.send("draft-syncs", taskId, draft);
  assert.equal(draftReply.status, 200);
  const submission = envelope(1, formPayload(acceptedValues));
  const submissionReply = await fixture.send("submissions", taskId, submission);
  assert.equal(submissionReply.status, 200);
  return { taskId, draft, draftReply, submission, submissionReply };
}

async function storedSubmissionPayload(pool: Pool, taskId: string) {
  const result = await pool.query(
    `SELECT revision.payload FROM audit_revisions revision
     JOIN audit_submissions submission ON submission.audit_id = revision.audit_id AND submission.revision = revision.revision
     JOIN audits audit ON audit.id = revision.audit_id WHERE audit.task_id = $1`,
    [taskId],
  );
  return result.rows[0]?.payload;
}

/** Sends one request to any /api/v1 route; `json` is undefined when the reply has no body (204). */
async function call(apiRoot: string, method: string, path: string, token: string | null, body?: unknown) {
  const response = await fetch(`${apiRoot}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) as Record<string, unknown> : undefined };
}

/** The mutating routes of the API, other than the two synchronization routes. */
const OTHER_MUTATING_ROUTES = [
  "POST /authenticate",
  "DELETE /session",
  "POST /tasks",
  "POST /employees",
  "POST /employees/:employeeId/credential",
  "POST /employees/:employeeId/password-reset",
  "PATCH /employees/:employeeId/status",
  "POST /authenticate/password",
];
const SYNC_ROUTES = ["POST /employee/tasks/:taskId/draft-syncs", "POST /employee/tasks/:taskId/submissions"];

test("F1 the assigned Employé cannot change accepted measurements or comments, whatever the base revision or payload", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const keysBefore = await outcomeKeys(pool, taskId);
    const before = await evidenceFingerprint(pool, taskId, keysBefore);
    const attempts: Array<[string, Kind, ReturnType<typeof envelope>]> = [];
    for (const kind of ["draft-syncs", "submissions"] as const) {
      attempts.push(
        ["current base", kind, envelope(2, formPayload(acceptedValues))],
        ["stale base", kind, envelope(0, formPayload(acceptedValues))],
        ["changed measurement and comment", kind, envelope(2, formPayload(changedValues))],
      );
    }
    for (const [label, kind, request] of attempts) {
      const reply = await send(kind, taskId, request);
      assert.equal(reply.status, 422, `${kind} ${label}`);
      assert.deepEqual([reply.body.outcome, reply.body.code, reply.body.message], ["rejected", "AUDIT_ALREADY_SUBMITTED", "Ce contrôle a déjà été soumis et accepté."]);
      assert.equal(reply.text.includes("Commentaire"), false, "no payload value in the body");
    }
    assert.equal(await evidenceFingerprint(pool, taskId, keysBefore), before);
    assert.equal((await outcomeKeys(pool, taskId)).length, keysBefore.length + attempts.length);
    assert.deepEqual(await storedSubmissionPayload(pool, taskId), formPayload(acceptedValues));
  });
});

test("F2 replays of the accepted submission and of a pre-acceptance draft-sync return their stored bodies and write nothing", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const { taskId, draft, draftReply, submission, submissionReply } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(pool, taskId);
    const submissionReplay = await send("submissions", taskId, submission);
    assert.deepEqual([submissionReplay.status, submissionReplay.text], [200, submissionReply.text]);
    const draftReplay = await send("draft-syncs", taskId, draft);
    assert.deepEqual([draftReplay.status, draftReplay.text], [200, draftReply.text]);
    // The accepted key with changed measurements and comment is not a replay: refused, stored body not disclosed.
    const reused = await send("submissions", taskId, { ...submission, payload: formPayload(changedValues) });
    assert.deepEqual([reused.status, reused.body], [422, { error: { code: "IDEMPOTENCY_KEY_REUSED", message: "Cette clé d’opération a déjà été utilisée pour une autre requête." } }]);
    assert.equal(await evidenceFingerprint(pool, taskId), before);
  });
});

test("F3 a Responsable, of the team or of another team, gets 403 on both synchronization routes", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(pool, taskId);
    for (const token of [tokens.owner, tokens.otherOwner]) {
      for (const kind of ["draft-syncs", "submissions"] as const) {
        const reply = await send(kind, taskId, envelope(2, formPayload(changedValues)), token);
        assert.deepEqual([reply.status, reply.body], [403, { error: { code: "FORBIDDEN", message: "Accès réservé à l’Employé." } }]);
      }
    }
    assert.equal(await evidenceFingerprint(pool, taskId), before);
  });
});

test("F4 an Employé who is not assigned gets 404 on both synchronization routes", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(pool, taskId);
    for (const token of [tokens.colleague, tokens.otherEmployee]) {
      for (const kind of ["draft-syncs", "submissions"] as const) {
        const reply = await send(kind, taskId, envelope(2, formPayload(changedValues)), token);
        assert.deepEqual([reply.status, reply.body], [404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }]);
      }
    }
    assert.equal(await evidenceFingerprint(pool, taskId), before);
  });
});

test("F5 every other mutating route, called by both roles, leaves the accepted evidence unchanged", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, apiRoot, tokens, employee, colleague } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(pool, taskId);
    // The credential route only regenerates a credential not yet replaced: use the Employé created just before.
    let createdEmployee = colleague;
    const calls: Array<[string, () => string, unknown]> = [
      ["POST", () => "/authenticate", { email: "inconnu@example.test", password: "mot-de-passe" }],
      ["POST", () => "/tasks", { establishment: "Établissement B", service: "Radiologie", type: "graphie_mobile", assigneeId: employee }],
      ["POST", () => "/employees", { firstName: "Nouveau", surname: "Test", email: `${randomUUID()}@example.test` }],
      ["POST", () => `/employees/${createdEmployee}/credential`, undefined],
      ["POST", () => `/employees/${colleague}/password-reset`, undefined],
      ["PATCH", () => `/employees/${employee}/status`, { active: false }],
      ["POST", () => "/authenticate/password", { currentPassword: "mot-de-passe", newPassword: "nouveau-mot-de-passe" }],
      ["DELETE", () => "/session", undefined],
    ];
    const statuses: string[] = [];
    // The Employé first: the Responsable's calls deactivate the Employé and end sessions.
    for (const token of [tokens.employee, tokens.owner]) {
      for (const [method, path, body] of calls) {
        const reply = await call(apiRoot, method, path(), token, body);
        statuses.push(`${token === tokens.owner ? "owner" : "employee"} ${method} ${path()} ${reply.status}`);
        if (token === tokens.owner && path() === "/employees" && reply.status === 201) {
          createdEmployee = (reply.json!.employee as { id: string }).id;
        }
        assert.equal(await evidenceFingerprint(pool, taskId), before, `${method} ${path()}`);
      }
    }
    const called = new Set(statuses.map((line) => line.split(" ").slice(1, 3).join(" ").replace(/\/[0-9a-f-]{36}\//, "/:employeeId/")));
    assert.deepEqual([...called].sort(), [...OTHER_MUTATING_ROUTES].sort());
    // The Responsable's routes really wrote, so the unchanged fingerprint is not only the result of refusals.
    const ownerWrites = statuses.filter((line) => line.startsWith("owner ")).map((line) => line.replace(/\/[0-9a-f-]{36}\//, "/:employeeId/"));
    for (const expected of [
      "owner POST /tasks 201",
      "owner POST /employees 201",
      "owner POST /employees/:employeeId/credential 200",
      "owner POST /employees/:employeeId/password-reset 200",
      "owner PATCH /employees/:employeeId/status 200",
      "owner DELETE /session 204",
    ]) {
      assert.ok(ownerWrites.includes(expected), expected);
    }
    assert.ok(statuses.includes("employee DELETE /session 204"), "the Employé's logout really ran");
  });
});

test("F6 the mutating routes registered by createApp are exactly the covered ones", () => {
  type Layer = { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };
  const collect = (stack: Layer[]): string[] => stack.flatMap((layer) => {
    if (layer.route) {
      return Object.keys(layer.route.methods).filter((method) => method !== "get" && method !== "head")
        .map((method) => `${method.toUpperCase()} ${layer.route!.path}`);
    }
    return layer.handle?.stack ? collect(layer.handle.stack) : [];
  });
  const app = createApp() as unknown as { router: { stack: Layer[] } };
  assert.deepEqual(collect(app.router.stack).sort(), [...OTHER_MUTATING_ROUTES, ...SYNC_ROUTES].sort());
});

test("D1 direct SQL cannot update or delete a submitted audit", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const otherTask = await fixture.newTask(employee);
    const before = await evidenceFingerprint(pool, taskId);
    const statements: Array<[string, unknown[], RegExp]> = [
      ["UPDATE audits SET state = 'draft' WHERE task_id = $1", [taskId], /frozen/],
      ["UPDATE audits SET current_revision = 1 WHERE task_id = $1", [taskId], /frozen/],
      ["UPDATE audits SET updated_by = $2 WHERE task_id = $1", [taskId, owner], /frozen/],
      ["UPDATE audits SET task_id = $2 WHERE task_id = $1", [taskId, otherTask], /frozen/],
      ["DELETE FROM audits WHERE task_id = $1", [taskId], /never deleted/],
    ];
    for (const [statement, values, message] of statements) {
      await assert.rejects(pool.query(statement, values), (error: Error & { code?: string }) => {
        assert.match(error.message, message, statement);
        assert.equal(error.code, "23001", statement);
        assert.equal(error.message.includes("Commentaire"), false);
        return true;
      });
    }
    assert.equal(await evidenceFingerprint(pool, taskId), before);
  });
});

test("D2 the task of an accepted submission cannot be deleted", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(pool, taskId);
    await assert.rejects(pool.query("DELETE FROM tasks WHERE id = $1", [taskId]), (error: { code?: string }) => error.code === "23503");
    assert.equal(await evidenceFingerprint(pool, taskId), before);
  });
});

test("D3 the evidence tables cannot be truncated, directly or through the tasks table", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(pool, taskId);
    const rows = await counts(pool);
    // CASCADE so foreign keys do not refuse first: the refusal must come from the freeze trigger of the named
    // table itself (its trigger fires before those of the cascaded tables), so each table's trigger is pinned.
    for (const table of ["audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes"]) {
      await assert.rejects(pool.query(`TRUNCATE ${table} CASCADE`), (error: Error & { code?: string }) => {
        assert.equal(error.message, `Evidence table ${table} cannot be truncated`, table);
        assert.equal(error.code, "23001", table);
        return true;
      });
    }
    await assert.rejects(pool.query("TRUNCATE tasks CASCADE"), /cannot be truncated/);
    assert.deepEqual(await counts(pool), rows);
    assert.equal(await evidenceFingerprint(pool, taskId), before);
  });
});

test("D4 a draft audit still accepts a draft-sync and then its submission", async () => {
  await withSyncFixture(async ({ pool, employee, newTask, send }) => {
    const taskId = await newTask(employee);
    assert.equal((await send("draft-syncs", taskId, envelope(0))).status, 200);
    assert.equal((await send("draft-syncs", taskId, envelope(1))).status, 200);
    const submitted = await send("submissions", taskId, envelope(2, formPayload(acceptedValues)));
    assert.deepEqual([submitted.status, submitted.body.serverRevision], [200, 3]);
    assert.deepEqual((await pool.query("SELECT state, current_revision FROM audits WHERE task_id = $1", [taskId])).rows, [{ state: "submitted", current_revision: 3 }]);
  });
});

test("D5 a second audit for the task and a second submission for the audit are refused", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(pool, taskId);
    await assert.rejects(pool.query(
      "INSERT INTO audits (task_id, state, current_revision, updated_at, updated_by) VALUES ($1, 'draft', 1, now(), $2)",
      [taskId, employee],
    ), (error: { code?: string }) => error.code === "23505");
    await assert.rejects(pool.query(
      `INSERT INTO audit_submissions (audit_id, revision, submitted_by, accepted_at, operation_id)
       SELECT id, 1, $2, now(), $3 FROM audits WHERE task_id = $1`,
      [taskId, employee, randomUUID()],
    ), (error: { code?: string }) => error.code === "23505");
    assert.equal(await evidenceFingerprint(pool, taskId), before);
  });
});

test("Q1 the team's Responsable reads the accepted snapshot exactly as accepted, after every refused attempt", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee, send, tokens, apiRoot } = fixture;
    const { taskId, submission, submissionReply } = await acceptedTask(fixture);
    const accepted = await getAcceptedSubmissionForReview(pool, owner, taskId);
    assert.ok(accepted);
    assert.deepEqual(accepted, {
      submissionId: submissionReply.body.submissionId,
      operationId: submission.operationId,
      taskId,
      auditId: (await pool.query("SELECT id FROM audits WHERE task_id = $1", [taskId])).rows[0].id,
      revision: 2,
      identity: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
      payload: formPayload(acceptedValues),
      results: JSON.parse(JSON.stringify(calculateGraphieResults(identity(), acceptedValues))),
      submittedBy: { id: employee, displayName: "Employé Test" },
      acceptedAt: submissionReply.body.acceptedAt,
    });
    assert.equal(accepted.payload.values["comments.general"], "Commentaire d’origine");

    // F1 to F5-style attempts by every actor, then direct SQL (D1 and D3 statements).
    for (const kind of ["draft-syncs", "submissions"] as const) {
      for (const base of [0, 2]) {
        for (const token of [tokens.employee, tokens.owner, tokens.otherOwner, tokens.colleague, tokens.otherEmployee]) {
          assert.notEqual((await send(kind, taskId, envelope(base, formPayload(changedValues)), token)).status, 200);
        }
      }
    }
    assert.equal((await send("submissions", taskId, submission)).status, 200);
    assert.equal((await send("submissions", taskId, { ...submission, payload: formPayload(changedValues) })).status, 422);
    assert.equal((await call(apiRoot, "POST", "/tasks", tokens.owner, { establishment: "Établissement B", service: "Radiologie", type: "graphie_mobile", assigneeId: employee })).status, 201);
    for (const statement of [
      "UPDATE audits SET state = 'draft' WHERE task_id = $1",
      "UPDATE audits SET current_revision = 1 WHERE task_id = $1",
      "DELETE FROM audits WHERE task_id = $1",
    ]) {
      await assert.rejects(pool.query(statement, [taskId]));
    }
    for (const table of ["audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes", "tasks"]) {
      await assert.rejects(pool.query(`TRUNCATE ${table} CASCADE`));
    }

    const after = await getAcceptedSubmissionForReview(pool, owner, taskId);
    assert.equal(JSON.stringify(after), JSON.stringify(accepted));
  });
});

test("Q2 the accepted snapshot is not returned for another team, an unknown or invalid task, or a task without submission", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, otherOwner, employee, newTask, send } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const draftOnly = await newTask(employee);
    assert.equal((await send("draft-syncs", draftOnly, envelope(0))).status, 200);
    assert.equal(await getAcceptedSubmissionForReview(pool, otherOwner, taskId), undefined);
    assert.equal(await getAcceptedSubmissionForReview(pool, owner, randomUUID()), undefined);
    assert.equal(await getAcceptedSubmissionForReview(pool, owner, "not-a-task"), undefined);
    assert.equal(await getAcceptedSubmissionForReview(pool, owner, draftOnly), undefined);
    assert.equal(await getAcceptedSubmissionForReview(pool, owner, await newTask(employee)), undefined);
  });
});

test("Q3 getOwnTeamTaskId recognises only the Responsable's own team tasks", async () => {
  await withSyncFixture(async ({ pool, owner, otherOwner, employee, otherEmployee, newTask }) => {
    const ownTask = await newTask(employee);
    const otherTask = await newTask(otherEmployee, otherOwner);
    assert.equal(await getOwnTeamTaskId(pool, owner, ownTask), ownTask);
    assert.equal(await getOwnTeamTaskId(pool, owner, ownTask.toUpperCase()), ownTask);
    assert.equal(await getOwnTeamTaskId(pool, owner, otherTask), undefined);
    assert.equal(await getOwnTeamTaskId(pool, otherOwner, otherTask), otherTask);
    assert.equal(await getOwnTeamTaskId(pool, owner, randomUUID()), undefined);
    assert.equal(await getOwnTeamTaskId(pool, owner, "not-a-task"), undefined);
  });
});

test("M1 migrating 0009 to 0010 keeps every row, freezes the submitted audit and keeps the draft audit open", async () => {
  await withPostgresUpgrade(async (fixture, migrate) => {
    const { pool, employee, newTask, send } = fixture;
    const submitted = await acceptedTask(fixture);
    const draftTask = await newTask(employee);
    assert.equal((await send("draft-syncs", draftTask, envelope(0))).status, 200);
    const dump = () => pool.query(
      `SELECT (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM tasks row)::text AS tasks,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM audits row)::text AS audits,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.audit_id, row.revision) FROM audit_revisions row)::text AS revisions,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM audit_submissions row)::text AS submissions,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.idempotency_key) FROM sync_operation_outcomes row)::text AS outcomes`,
    ).then((result) => result.rows[0]);
    const before = await dump();
    await migrate();
    assert.deepEqual(await dump(), before);
    await assert.rejects(pool.query("UPDATE audits SET state = 'draft' WHERE task_id = $1", [submitted.taskId]), /frozen/);
    assert.equal((await send("draft-syncs", draftTask, envelope(1))).status, 200);
  });
});

/** The sync fixture stopped at migration 0009, with a function applying the remaining migrations. */
async function withPostgresUpgrade(run: (fixture: SyncFixture, migrate: () => Promise<void>) => Promise<void>) {
  await withSyncFixture(async (fixture) => {
    await run(fixture, () => migrate(fixture.pool));
  }, { migrateThrough: "0009_audits_and_sync" });
}
