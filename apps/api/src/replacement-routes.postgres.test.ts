import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { employeeTaskListResponseSchema, employeeTaskResponseSchema, replacementTaskResponseSchema, taskListResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { migrate } from "./db/migrate.js";
import { replacementCommandTestSeams } from "./modules/audits/commands/create-replacement-control.js";
import { listEligibleTaskAssignees } from "./modules/tasks/tasks.js";
import { account, addSession, counts, envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 8.3: a Responsable-only replacement control of a server-accepted audit (synthetic names only).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const NOT_ACCEPTED = { error: { code: "AUDIT_NOT_ACCEPTED", message: "Cette tâche n’a pas d’audit accepté par le serveur." } };
const ALREADY_REPLACED = { error: { code: "REPLACEMENT_ALREADY_EXISTS", message: "Un contrôle de remplacement existe déjà pour cet audit." } };
const ASSIGNEE_UNAVAILABLE = { error: { code: "TASK_ASSIGNEE_UNAVAILABLE", message: "Ce Technicien n’est pas actif ou ne fait pas partie de votre équipe." } };

const taskBody = (assigneeId: string, establishment = "Établissement Remplacement") =>
  ({ establishment, service: "Radiologie", type: "graphie_mobile", assigneeId });

type Reply = { status: number; text: string; body: Record<string, unknown>; cacheControl: string | null };

async function call(fixture: SyncFixture, method: "GET" | "POST", path: string, token: string | null, body?: unknown): Promise<Reply> {
  const response = await fetch(`${fixture.apiRoot}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: response.headers.get("cache-control") };
}

const replace = (fixture: SyncFixture, originalTaskId: string, body: unknown, token: string | null = fixture.tokens.owner) =>
  call(fixture, "POST", `/tasks/${originalTaskId}/replacements`, token, body);

/** A task of `assignee` whose audit was accepted by a real submission (7.3 path). */
async function acceptedTask(fixture: SyncFixture, assignee = fixture.employee, owner = fixture.owner, token = fixture.tokens.employee) {
  const taskId = await fixture.newTask(assignee, owner);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload({ "header.reportNumber": "R-083", "comments.general": "Commentaire d’origine" })), token);
  assert.equal(reply.status, 200);
  return taskId;
}

async function writeCounts(pool: Pool) {
  const result = await pool.query<{ tasks: number; assignments: number; links: number; lineage: number }>(
    `SELECT (SELECT count(*) FROM tasks)::int AS tasks, (SELECT count(*) FROM task_assignments)::int AS assignments,
            (SELECT count(*) FROM audit_replacement_links)::int AS links, (SELECT count(*) FROM audit_lineage_links)::int AS lineage`,
  );
  return { ...await counts(pool), ...result.rows[0]! };
}

/** Every row of the original task, serialized by PostgreSQL itself (timestamps keep their microseconds). */
async function originalFingerprint(pool: Pool, taskId: string): Promise<string> {
  const result = await pool.query<{ fingerprint: string }>(
    `SELECT jsonb_build_object(
       'task', (SELECT to_jsonb(task) FROM tasks task WHERE task.id = $1),
       'assignment', (SELECT to_jsonb(assignment) FROM task_assignments assignment WHERE assignment.task_id = $1),
       'audit', (SELECT to_jsonb(audit) FROM audits audit WHERE audit.task_id = $1),
       'revisions', (SELECT coalesce(jsonb_agg(to_jsonb(revision) ORDER BY revision.revision), '[]'::jsonb)
                     FROM audit_revisions revision JOIN audits audit ON audit.id = revision.audit_id WHERE audit.task_id = $1),
       'submission', (SELECT to_jsonb(submission) FROM audit_submissions submission JOIN audits audit ON audit.id = submission.audit_id WHERE audit.task_id = $1),
       'outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(outcome) ORDER BY outcome.idempotency_key), '[]'::jsonb) FROM sync_operation_outcomes outcome WHERE outcome.task_id = $1),
       'lineage', (SELECT coalesce(jsonb_agg(to_jsonb(link) ORDER BY link.id), '[]'::jsonb)
                   FROM audit_lineage_links link JOIN audits audit ON audit.id = link.audit_id WHERE audit.task_id = $1)
     )::text AS fingerprint`,
    [taskId],
  );
  return result.rows[0]!.fingerprint;
}

async function addEmployee(fixture: SyncFixture, name: string, responsable = fixture.owner) {
  const client = await fixture.pool.connect();
  try {
    const team = await client.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [responsable]);
    return await account(client, "employe", name, team.rows[0]!.id);
  } finally {
    client.release();
  }
}

test("L17 an accepted own-team task gets a 201 that writes exactly one task, one assignment and one replacement-control link", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee, colleague } = fixture;
    const originalTaskId = await acceptedTask(fixture);
    const before = await writeCounts(pool);
    const reply = await replace(fixture, originalTaskId.toUpperCase(), taskBody(colleague));
    assert.equal(reply.status, 201);
    assert.match(reply.cacheControl ?? "", /no-store/);
    const body = replacementTaskResponseSchema.parse(reply.body);
    const audit = (await pool.query("SELECT id FROM audits WHERE task_id = $1", [originalTaskId])).rows[0]!.id as string;
    const submission = (await pool.query("SELECT id FROM audit_submissions WHERE audit_id = $1", [audit])).rows[0]!.id as string;
    assert.deepEqual(body.replacementOf, { taskId: originalTaskId, auditId: audit });
    assert.deepEqual({ ...body.task, id: "", createdAt: "" }, {
      id: "", establishment: "Établissement Remplacement", service: "Radiologie", type: "graphie_mobile",
      assigneeId: colleague, creatorId: owner, createdAt: "", state: "draft",
    });
    assert.notEqual(body.task.id, originalTaskId);
    assert.deepEqual(await writeCounts(pool), { ...before, tasks: before.tasks + 1, assignments: before.assignments + 1, links: before.links + 1 });

    const links = await pool.query("SELECT link_type, original_task_id, original_audit_id, original_submission_id, replacement_task_id, actor_id FROM audit_replacement_links");
    assert.deepEqual(links.rows, [{
      link_type: "replacement-control", original_task_id: originalTaskId, original_audit_id: audit,
      original_submission_id: submission, replacement_task_id: body.task.id, actor_id: owner,
    }]);
    const created = await pool.query(
      `SELECT task.state, task.created_by, assignment.employee_id FROM tasks task JOIN task_assignments assignment ON assignment.task_id = task.id WHERE task.id = $1`,
      [body.task.id],
    );
    assert.deepEqual(created.rows, [{ state: "draft", created_by: owner, employee_id: colleague }]);
    // Nothing is copied: the replacement has no audit, revision, submission or outcome.
    assert.equal((await pool.query("SELECT 1 FROM audits WHERE task_id = $1", [body.task.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM sync_operation_outcomes WHERE task_id = $1", [body.task.id])).rowCount, 0);
    assert.notEqual(employee, colleague);
  });
});

test("L18 the original's task, assignment, audit, revisions, submission, outcomes and lineage rows are byte-identical", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, send } = fixture;
    const originalTaskId = await fixture.newTask(employee);
    // A draft-sync, a conflict resolved by keep-local (8.1 lineage), then the accepted submission.
    assert.equal((await send("draft-syncs", originalTaskId, envelope(0))).status, 200);
    const conflict = envelope(0);
    assert.equal((await send("draft-syncs", originalTaskId, conflict)).status, 409);
    assert.equal((await send("submissions", originalTaskId, envelope(1, formPayload(), { conflictOperationId: conflict.operationId }))).status, 200);
    const before = await originalFingerprint(pool, originalTaskId);
    assert.match(before, /sync-conflict-revision/);
    assert.equal((await replace(fixture, originalTaskId, taskBody(employee))).status, 201);
    assert.equal(await originalFingerprint(pool, originalTaskId), before);
  });
});

test("L19 every refusal writes nothing and returns its documented code", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, colleague, otherEmployee, otherOwner, tokens, send } = fixture;
    const accepted = await acceptedTask(fixture);
    const foreignAccepted = await acceptedTask(fixture, otherEmployee, otherOwner, tokens.otherEmployee);
    const draftAudit = await fixture.newTask(employee);
    assert.equal((await send("draft-syncs", draftAudit, envelope(0))).status, 200);
    const noAudit = await fixture.newTask(employee);
    const replaced = await acceptedTask(fixture);
    assert.equal((await replace(fixture, replaced, taskBody(colleague))).status, 201);
    const inactive = await addEmployee(fixture, "Inactif Test");
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [inactive]);

    const before = await writeCounts(pool);
    const fingerprints = async () => Promise.all([accepted, foreignAccepted, draftAudit, noAudit, replaced].map((id) => originalFingerprint(pool, id)));
    const fingerprintsBefore = await fingerprints();
    const cases: Array<[string, () => Promise<Reply>, number, unknown]> = [
      ["Employé session", () => replace(fixture, accepted, taskBody(colleague), tokens.employee), 403, { error: { code: "FORBIDDEN", message: "Action réservée au Responsable de l’équipe." } }],
      ["malformed ID", () => replace(fixture, "pas-une-tache", taskBody(colleague)), 404, NOT_FOUND],
      ["unknown ID", () => replace(fixture, randomUUID(), taskBody(colleague)), 404, NOT_FOUND],
      ["another team's accepted task", () => replace(fixture, foreignAccepted, taskBody(colleague)), 404, NOT_FOUND],
      ["draft audit", () => replace(fixture, draftAudit, taskBody(colleague)), 409, NOT_ACCEPTED],
      ["no audit", () => replace(fixture, noAudit, taskBody(colleague)), 409, NOT_ACCEPTED],
      ["second replacement", () => replace(fixture, replaced, taskBody(colleague)), 409, ALREADY_REPLACED],
      ["inactive assignee", () => replace(fixture, accepted, taskBody(inactive)), 422, ASSIGNEE_UNAVAILABLE],
      ["assignee from another team", () => replace(fixture, accepted, taskBody(otherEmployee)), 422, ASSIGNEE_UNAVAILABLE],
      ["unknown assignee", () => replace(fixture, accepted, taskBody(randomUUID())), 422, ASSIGNEE_UNAVAILABLE],
    ];
    for (const [label, run, status, body] of cases) {
      const reply = await run();
      assert.deepEqual([reply.status, reply.body], [status, body], label);
      assert.match(reply.cacheControl ?? "", /no-store/, label);
    }
    for (const invalid of [{}, { ...taskBody(colleague), establishment: "" }, { ...taskBody(colleague), type: "scopie" }, { ...taskBody(colleague), assigneeId: "employe" }, { ...taskBody(colleague), extra: true }]) {
      const reply = await replace(fixture, accepted, invalid);
      assert.equal(reply.status, 400, JSON.stringify(invalid));
      assert.equal((reply.body.error as { code: string; message: string }).code, "VALIDATION_ERROR");
      assert.equal((reply.body.error as { message: string }).message, "L’établissement, le type Graphie Mobile et un Technicien responsable sont requis.");
    }
    const malformedJson = await replace(fixture, accepted, "{");
    assert.equal(malformedJson.status, 400);
    const anonymous = await replace(fixture, accepted, taskBody(colleague), null);
    assert.equal(anonymous.status, 401);
    // Another team's Responsable cannot replace our task either, with the same body as unknown.
    const foreignOwner = await replace(fixture, accepted, taskBody(otherEmployee), tokens.otherOwner);
    assert.deepEqual([foreignOwner.status, foreignOwner.body], [404, NOT_FOUND]);

    assert.deepEqual(await writeCounts(pool), before);
    assert.deepEqual(await fingerprints(), fingerprintsBefore);
  });
});

test("L20 two concurrent replacement requests for the same original give one 201 and one 409", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, colleague } = fixture;
    const originalTaskId = await acceptedTask(fixture);
    const before = await writeCounts(pool);
    const replies = await Promise.all([replace(fixture, originalTaskId, taskBody(employee, "A")), replace(fixture, originalTaskId, taskBody(colleague, "B"))]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [201, 409]);
    assert.deepEqual(replies.find((reply) => reply.status === 409)!.body, ALREADY_REPLACED);
    assert.deepEqual(await writeCounts(pool), { ...before, tasks: before.tasks + 1, assignments: before.assignments + 1, links: before.links + 1 });
  });
});

test("L21 a failure injected after the task insert rolls back the task, the assignment and the link", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, colleague } = fixture;
    const originalTaskId = await acceptedTask(fixture);
    const before = await writeCounts(pool);
    const original = await originalFingerprint(pool, originalTaskId);
    let injected = 0;
    replacementCommandTestSeams.afterTaskInsert = async () => {
      injected++;
      // The task and its assignment exist in the transaction at this point.
      throw new Error("injected failure");
    };
    try {
      const reply = await replace(fixture, originalTaskId, taskBody(colleague));
      assert.deepEqual([reply.status, reply.body], [500, { error: { code: "INTERNAL_ERROR", message: "Le contrôle de remplacement n’a pas pu être créé." } }]);
      assert.equal(reply.text.includes("injected"), false);
    } finally {
      replacementCommandTestSeams.afterTaskInsert = undefined;
    }
    assert.equal(injected, 1);
    assert.deepEqual(await writeCounts(pool), before);
    assert.equal(await originalFingerprint(pool, originalTaskId), original);
    assert.equal((await replace(fixture, originalTaskId, taskBody(colleague))).status, 201, "the original stays replaceable");
  });
});

test("L22 the replacement is synchronized and accepted independently, with its own audit, and can itself be replaced", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, colleague, tokens, send } = fixture;
    const originalTaskId = await acceptedTask(fixture);
    const original = await originalFingerprint(pool, originalTaskId);
    const created = replacementTaskResponseSchema.parse((await replace(fixture, originalTaskId, taskBody(colleague))).body);
    const replacementTaskId = created.task.id;

    // The replacement starts at revision 0: nothing is carried over from the original audit.
    const version = await call(fixture, "GET", `/employee/tasks/${replacementTaskId}/audit-version`, tokens.colleague);
    assert.deepEqual([version.status, version.body.revision, version.body.state, version.body.payload], [200, 0, "draft", null]);
    const draft = await send("draft-syncs", replacementTaskId, envelope(0, formPayload({ "header.reportNumber": "R-083-B" })), tokens.colleague);
    assert.deepEqual([draft.status, draft.body.serverRevision], [200, 1]);
    const submitted = await send("submissions", replacementTaskId, envelope(1, formPayload({ "header.reportNumber": "R-083-B", "comments.general": "Nouveau contrôle" })), tokens.colleague);
    assert.deepEqual([submitted.status, submitted.body.serverRevision], [200, 2]);

    const audits = await pool.query<{ task_id: string; id: string; state: string; current_revision: number; updated_by: string }>(
      "SELECT task_id, id, state, current_revision, updated_by FROM audits WHERE task_id = ANY($1::uuid[])", [[originalTaskId, replacementTaskId]],
    );
    const replacementAudit = audits.rows.find((row) => row.task_id === replacementTaskId)!;
    assert.deepEqual([replacementAudit.state, replacementAudit.current_revision, replacementAudit.updated_by], ["submitted", 2, colleague]);
    assert.notEqual(replacementAudit.id, created.replacementOf.auditId);
    assert.equal(await originalFingerprint(pool, originalTaskId), original);
    // The original's assigned Employé cannot act on the replacement task.
    assert.equal((await send("draft-syncs", replacementTaskId, envelope(2), tokens.employee)).status, 404);

    const chained = await replace(fixture, replacementTaskId, taskBody(employee));
    assert.equal(chained.status, 201);
    assert.deepEqual(replacementTaskResponseSchema.parse(chained.body).replacementOf, { taskId: replacementTaskId, auditId: replacementAudit.id });
    assert.deepEqual((await replace(fixture, replacementTaskId, taskBody(employee))).body, ALREADY_REPLACED);
  });
});

test("L23 GET /tasks reports the accepted state and the lineage in both directions, for the own team only", async () => {
  await withSyncFixture(async (fixture) => {
    const { employee, colleague, otherEmployee, otherOwner, tokens, send } = fixture;
    const originalTaskId = await acceptedTask(fixture);
    const replacementTaskId = replacementTaskResponseSchema.parse((await replace(fixture, originalTaskId, taskBody(colleague))).body).task.id;
    const plainTask = await fixture.newTask(employee);
    const draftTask = await fixture.newTask(employee);
    assert.equal((await send("draft-syncs", draftTask, envelope(0))).status, 200);
    const acceptedOnly = await acceptedTask(fixture);
    // Another team's accepted task and replacement.
    const foreignOriginal = await acceptedTask(fixture, otherEmployee, otherOwner, tokens.otherEmployee);
    const foreignReplacement = replacementTaskResponseSchema.parse((await replace(fixture, foreignOriginal, taskBody(otherEmployee), tokens.otherOwner)).body).task.id;

    const reply = await call(fixture, "GET", "/tasks", tokens.owner);
    assert.equal(reply.status, 200);
    assert.match(reply.cacheControl ?? "", /no-store/);
    const { tasks } = taskListResponseSchema.parse(reply.body);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const view = (id: string) => {
      const task = byId.get(id);
      return task && { state: task.state, replacementOf: task.replacementOf, replacedBy: task.replacedBy };
    };
    assert.deepEqual(view(originalTaskId), { state: "submitted", replacementOf: null, replacedBy: replacementTaskId });
    assert.deepEqual(view(replacementTaskId), { state: "draft", replacementOf: originalTaskId, replacedBy: null });
    assert.deepEqual(view(plainTask), { state: "draft", replacementOf: null, replacedBy: null });
    assert.deepEqual(view(draftTask), { state: "draft", replacementOf: null, replacedBy: null });
    assert.deepEqual(view(acceptedOnly), { state: "submitted", replacementOf: null, replacedBy: null });
    assert.equal(tasks.length, 5);
    assert.equal(reply.text.includes(foreignOriginal), false);
    assert.equal(reply.text.includes(foreignReplacement), false);

    const foreign = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.otherOwner)).body).tasks;
    assert.deepEqual(foreign.map((task) => [task.id, task.state, task.replacementOf, task.replacedBy]).sort(), [
      [foreignOriginal, "submitted", null, foreignReplacement],
      [foreignReplacement, "draft", foreignOriginal, null],
    ].sort());
    // The original task row is never written: its lastUpdatedAt is still the task's updated_at.
    const updatedAt = (await fixture.pool.query("SELECT updated_at FROM tasks WHERE id = $1", [originalTaskId])).rows[0]!.updated_at as Date;
    assert.equal(byId.get(originalTaskId)!.lastUpdatedAt, updatedAt.toISOString());
  });
});

test("L24 migrating 0012 to 0013 keeps every row; the replacement links are insert-only and constrained", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee, colleague, send } = fixture;
    const originalTaskId = await acceptedTask(fixture);
    const draftTask = await fixture.newTask(employee);
    assert.equal((await send("draft-syncs", draftTask, envelope(0))).status, 200);
    await assert.rejects(pool.query("SELECT 1 FROM audit_replacement_links"), /does not exist/);
    const dump = () => pool.query(
      `SELECT (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM tasks row)::text AS tasks,
              (SELECT jsonb_agg(jsonb_build_object('task_id', row.task_id, 'team_id', row.team_id, 'employee_id', row.employee_id, 'assigned_at', row.assigned_at) ORDER BY row.task_id) FROM task_assignments row)::text AS assignments,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM audits row)::text AS audits,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.audit_id, row.revision) FROM audit_revisions row)::text AS revisions,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM audit_submissions row)::text AS submissions,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.idempotency_key) FROM sync_operation_outcomes row)::text AS outcomes,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM audit_lineage_links row)::text AS lineage`,
    ).then((result) => result.rows[0]);
    const before = await dump();
    await migrate(pool);
    assert.deepEqual(await dump(), before);

    assert.equal((await replace(fixture, originalTaskId, taskBody(colleague))).status, 201);
    const links = await pool.query("SELECT * FROM audit_replacement_links");
    assert.equal(links.rowCount, 1);
    const link = links.rows[0]!;
    for (const statement of ["UPDATE audit_replacement_links SET actor_id = actor_id", "DELETE FROM audit_replacement_links"]) {
      await assert.rejects(pool.query(statement), /insert-only/);
    }
    await assert.rejects(pool.query("TRUNCATE audit_replacement_links"), /cannot be truncated/);
    const insert = (values: Record<string, unknown>) => {
      const row = { link_type: "replacement-control", original_task_id: link.original_task_id, original_audit_id: link.original_audit_id,
        original_submission_id: link.original_submission_id, replacement_task_id: draftTask, actor_id: owner, ...values };
      return pool.query(
        `INSERT INTO audit_replacement_links (link_type, original_task_id, original_audit_id, original_submission_id, replacement_task_id, actor_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.link_type, row.original_task_id, row.original_audit_id, row.original_submission_id, row.replacement_task_id, row.actor_id],
      );
    };
    for (const linkType of ["sync-conflict-revision", "rejected-submission-correction", "replacement"]) {
      await assert.rejects(insert({ link_type: linkType }), /check constraint/);
    }
    // A second row for the same original (and so the same accepted submission) is refused by a UNIQUE constraint.
    await assert.rejects(insert({}), (error: { code?: string; constraint?: string }) => error.code === "23505" && /original_(task|submission)_id/.test(error.constraint ?? ""));
    // The same task on both sides is refused by the CHECK (a fresh original, so no UNIQUE fires first).
    const otherOriginal = await acceptedTask(fixture);
    const otherAudit = (await pool.query("SELECT audit.id AS audit_id, submission.id AS submission_id FROM audits audit JOIN audit_submissions submission ON submission.audit_id = audit.id WHERE audit.task_id = $1", [otherOriginal])).rows[0]!;
    await assert.rejects(insert({ original_task_id: otherOriginal, original_audit_id: otherAudit.audit_id, original_submission_id: otherAudit.submission_id, replacement_task_id: otherOriginal }), /check constraint/);
    assert.equal((await pool.query("SELECT 1 FROM audit_replacement_links")).rowCount, 1);
  }, { migrateThrough: "0012_correction_lineage" });
});

test("L25 a deactivated original assignee does not block a replacement assigned to an active Employé", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, colleague } = fixture;
    const originalTaskId = await acceptedTask(fixture);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
    const choices = await listEligibleTaskAssignees(pool, fixture.owner);
    assert.deepEqual(choices.map((assignee) => assignee.id), [colleague], "replacement choices contain active own-team employees only");
    const original = await originalFingerprint(pool, originalTaskId);
    const reply = await replace(fixture, originalTaskId, taskBody(colleague));
    assert.equal(reply.status, 201);
    assert.equal(replacementTaskResponseSchema.parse(reply.body).task.assigneeId, colleague);
    const ownerTaskList = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", fixture.tokens.owner)).body);
    const originalRow = ownerTaskList.tasks.find((task) => task.id === originalTaskId)!;
    assert.equal(originalRow.state, "submitted");
    assert.equal(originalRow.assignee, "Employ\u00e9 Test \u2014 Inactif");
    assert.equal(originalRow.replacedBy, replacementTaskResponseSchema.parse(reply.body).task.id);
    assert.deepEqual((await replace(fixture, originalTaskId, taskBody(colleague))).body, ALREADY_REPLACED);
    // The deactivated Employé cannot be the assignee of a replacement.
    const second = await acceptedTask(fixture, colleague, fixture.owner, fixture.tokens.colleague);
    assert.deepEqual((await replace(fixture, second, taskBody(employee))).body, ASSIGNEE_UNAVAILABLE);
    assert.equal(await originalFingerprint(pool, originalTaskId), original);
  });
});

test("L26 the Employé task surfaces keep their schemas and carry no lineage field", async () => {
  await withSyncFixture(async (fixture) => {
    const { colleague, tokens } = fixture;
    const originalTaskId = await acceptedTask(fixture);
    const replacementTaskId = replacementTaskResponseSchema.parse((await replace(fixture, originalTaskId, taskBody(colleague))).body).task.id;
    for (const [token, taskId] of [[tokens.employee, originalTaskId], [tokens.colleague, replacementTaskId]] as const) {
      const list = await call(fixture, "GET", "/employee/tasks", token);
      assert.equal(list.status, 200);
      const parsed = employeeTaskListResponseSchema.parse(list.body);
      assert.deepEqual(parsed.tasks.map((task) => task.id), [taskId]);
      const detail = await call(fixture, "GET", `/employee/tasks/${taskId}`, token);
      assert.equal(detail.status, 200);
      employeeTaskResponseSchema.parse(detail.body);
      for (const text of [list.text, detail.text]) {
        assert.doesNotMatch(text, /replacement|replaced/i);
      }
      const other = token === tokens.employee ? replacementTaskId : originalTaskId;
      assert.equal(list.text.includes(other), false);
      assert.equal(detail.text.includes(other), false);
    }
    // The Employé's own session is refused on the replacement route for their own task.
    assert.equal((await replace(fixture, replacementTaskId, taskBody(colleague), tokens.colleague)).status, 403);
    // A session created after the replacement still sees no lineage.
    const fresh = await addSession(fixture.pool, colleague);
    assert.doesNotMatch((await call(fixture, "GET", "/employee/tasks", fresh)).text, /replace/i);
  });
});
