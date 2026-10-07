import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY, calculateGraphieResults } from "@cetem-qc/domain";
import { acceptedEvidenceResponseSchema, employeeTaskAuditVersionSchema, employeeTaskListResponseSchema, employeeTaskResponseSchema, taskListResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { migrate } from "./db/migrate.js";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { account, addSession, envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 9.1: read-only review of accepted audit evidence by the Responsable (synthetic names only).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const LOAD_FAILED = { error: { code: "INTERNAL_ERROR", message: "Les preuves n’ont pas pu être chargées." } };
const LONE_SURROGATE = formPayload({ "header.reportNumber": "R-\uD800" });

type Reply = { status: number; text: string; body: Record<string, unknown>; cacheControl: string | null };

async function call(fixture: SyncFixture, method: "GET" | "POST", path: string, token: string | null, body?: unknown): Promise<Reply> {
  const response = await fetch(`${fixture.apiRoot}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: response.headers.get("cache-control") };
}

const evidence = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner) => call(fixture, "GET", `/tasks/${taskId}/accepted-evidence`, token);

/** A task whose audit was accepted by a real submission (7.3 path); returns the task ID and the accepting response. */
async function acceptedTask(fixture: SyncFixture, values: Record<string, string> = { "header.reportNumber": "R-091", "comments.general": "Commentaire" }, assignee = fixture.employee, token = fixture.tokens.employee) {
  const taskId = await fixture.newTask(assignee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload(values)), token);
  assert.equal(reply.status, 200);
  return { taskId, reply };
}

async function accessRows(pool: Pool) {
  const result = await pool.query<{ actor_id: string; task_id: string; audit_id: string; submission_id: string; accessed_at: Date }>(
    "SELECT actor_id, task_id, audit_id, submission_id, accessed_at FROM audit_review_accesses ORDER BY accessed_at, id",
  );
  return result.rows;
}

/** Every evidence and task table, serialized by PostgreSQL itself so timestamps keep their microseconds. */
async function evidenceFingerprint(pool: Pool): Promise<string> {
  const tables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes",
    "audit_lineage_links", "audit_replacement_links", "audit_deactivated_assignee_recovery_links", "audit_recovery_field_provenance"];
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  const result = await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`);
  return result.rows[0]!.fingerprint;
}

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    return { result: await run(), lines };
  } finally {
    console.info = original;
  }
}

test("R1 an own-team Responsable gets the exact stored evidence and one access row with their ID", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee } = fixture;
    const values = { "header.reportNumber": "R-091", "comments.general": "Commentaire", "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2" };
    const { taskId, reply } = await acceptedTask(fixture, values);
    const before = Date.now();
    const reply2 = await evidence(fixture, taskId);
    assert.equal(reply2.status, 200);
    assert.match(reply2.cacheControl ?? "", /no-store/i);
    const body = acceptedEvidenceResponseSchema.parse(reply2.body);
    const stored = (await pool.query<{ payload: { values: Record<string, string> }; results: unknown; audit_id: string }>(
      "SELECT revision.payload, revision.results, audit.id AS audit_id FROM audits audit JOIN audit_revisions revision ON revision.audit_id = audit.id AND revision.revision = audit.current_revision WHERE audit.task_id = $1", [taskId],
    )).rows[0]!;
    assert.deepEqual(body.values, values);
    assert.deepEqual(body.values, stored.payload.values);
    assert.deepEqual(body.results, stored.results);
    assert.deepEqual(body.results, calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, values));
    assert.deepEqual(body.identity, GRAPHIE_CALCULATION_IDENTITY);
    assert.deepEqual(body.task, { id: taskId, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" });
    assert.deepEqual(body.submission, { submissionId: reply.body.submissionId, auditId: stored.audit_id, revision: 1, submittedBy: { id: employee, displayName: "Employé Test" }, acceptedAt: reply.body.acceptedAt });
    assert.deepEqual(body.lineage, { replacementOf: null, replacedBy: null, recoverySource: null, recoverySuccessorTaskId: null });
    const rows = await accessRows(pool);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0]!.actor_id, rows[0]!.task_id, rows[0]!.audit_id, rows[0]!.submission_id], [owner, taskId, stored.audit_id, reply.body.submissionId]);
    assert.ok(Math.abs(rows[0]!.accessed_at.getTime() - before) < 60_000, "the date is the server date");
  });
});

test("R2 repeated opens add one access row each and change no evidence, task or lineage row", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(fixture.pool);
    for (let open = 1; open <= 3; open++) {
      assert.equal((await evidence(fixture, taskId)).status, 200);
      assert.equal((await accessRows(fixture.pool)).length, open);
    }
    assert.equal(await evidenceFingerprint(fixture.pool), before);
  });
});

test("R3/R4 every refusal writes no access row, uses its documented code and logs one structured line without the requested ID", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee, tokens } = fixture;
    const secretValues = { "header.reportNumber": "R-SECRET-VALUE", "comments.general": "Valeur-confidentielle" };
    const { taskId: foreignTask } = await acceptedTask(fixture, secretValues);
    const draftTask = await fixture.newTask(employee);
    await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-BROUILLON" })));
    const noAuditTask = await fixture.newTask(employee);
    const unknown = "00000000-0000-4000-8000-0000000000aa";
    const attempts: Array<{ label: string; taskId: string; token: string; status: number; body: unknown; refusalClass: string }> = [
      { label: "employee", taskId: foreignTask, token: tokens.employee, status: 403, body: FORBIDDEN, refusalClass: "forbidden-role" },
      { label: "malformed", taskId: "not-a-uuid", token: tokens.owner, status: 404, body: NOT_FOUND, refusalClass: "not-found" },
      { label: "unknown", taskId: unknown, token: tokens.owner, status: 404, body: NOT_FOUND, refusalClass: "not-found" },
      { label: "another team", taskId: foreignTask, token: tokens.otherOwner, status: 404, body: NOT_FOUND, refusalClass: "not-found" },
      { label: "draft audit", taskId: draftTask, token: tokens.owner, status: 404, body: NOT_FOUND, refusalClass: "not-found" },
      { label: "no audit", taskId: noAuditTask, token: tokens.owner, status: 404, body: NOT_FOUND, refusalClass: "not-found" },
    ];
    const texts = new Set<string>();
    for (const attempt of attempts) {
      const { result, lines } = await captureInfo(() => evidence(fixture, attempt.taskId, attempt.token));
      assert.equal(result.status, attempt.status, attempt.label);
      assert.deepEqual(result.body, attempt.body, attempt.label);
      assert.match(result.cacheControl ?? "", /no-store/i);
      if (attempt.status === 404) texts.add(result.text);
      const actor = attempt.token === tokens.employee ? employee : attempt.token === tokens.otherOwner ? fixture.otherOwner : owner;
      assert.equal(lines.length, 1, `${attempt.label}: one log line`);
      assert.deepEqual(JSON.parse(lines[0]!), { event: "audit.review_refused", class: attempt.refusalClass, actorId: actor });
      assert.ok(!lines[0]!.includes(attempt.taskId) && !lines[0]!.includes("SECRET") && !lines[0]!.includes("confidentielle"), `${attempt.label}: no requested ID or evidence in the line`);
      assert.equal((await accessRows(pool)).length, 0, `${attempt.label}: no access row`);
    }
    assert.equal(texts.size, 1, "all 404 bodies are byte-identical");
    const only = [...texts][0]!;
    for (const forbidden of [foreignTask, "auditId", "team", "establishment"]) assert.ok(!only.includes(forbidden));
    assert.equal((await call(fixture, "GET", `/tasks/${foreignTask}/accepted-evidence`, null)).status, 401);
  });
});

test("R5 a failure at the access insert returns 500 without any evidence and leaves zero rows", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture, { "header.reportNumber": "R-SECRET-VALUE" });
    reviewCommandTestSeams.beforeAccessInsert = () => { throw new Error("injected insert failure R-SECRET-VALUE"); };
    try {
      const { result, lines } = await captureInfo(() => evidence(fixture, taskId));
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, LOAD_FAILED);
      assert.ok(!result.text.includes("SECRET") && !("task" in result.body) && !("values" in result.body));
      assert.deepEqual(lines, []);
      assert.equal((await accessRows(fixture.pool)).length, 0);
    } finally {
      reviewCommandTestSeams.beforeAccessInsert = undefined;
    }
    assert.equal((await evidence(fixture, taskId)).status, 200);
    assert.equal((await accessRows(fixture.pool)).length, 1);
  });
});

test("R6 a results snapshot under another rule identity gives 500 and no access row; consistent and unsupported snapshots pass", async () => {
  await withSyncFixture(async (fixture) => {
    const values = { "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2" };
    const { taskId } = await acceptedTask(fixture, values);
    try {
      reviewCommandTestSeams.snapshot = (snapshot) => ({
        ...snapshot,
        results: { ...snapshot.results, voltageAccuracy: { ...snapshot.results.voltageAccuracy, ruleVersion: "9.9.9" } } as typeof snapshot.results,
      });
      const { result, lines } = await captureInfo(() => evidence(fixture, taskId));
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, LOAD_FAILED);
      assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ event: "audit.review_inconsistent", actorId: fixture.owner }]);
      assert.equal((await accessRows(fixture.pool)).length, 0);

      // Supported results under an unsupported revision identity are inconsistent too.
      reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, identity: { ...snapshot.identity, ruleVersion: "1.0.0" } });
      assert.equal((await captureInfo(() => evidence(fixture, taskId))).result.status, 500);
      assert.equal((await accessRows(fixture.pool)).length, 0);

      // An unsupported identity with five unsupported-version results is consistent.
      const unsupported = { ...GRAPHIE_CALCULATION_IDENTITY, ruleVersion: "1.0.0" };
      reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, identity: unsupported, results: calculateGraphieResults(unsupported, snapshot.payload.values) });
      const reply = await evidence(fixture, taskId);
      assert.equal(reply.status, 200);
      const body = acceptedEvidenceResponseSchema.parse(reply.body);
      assert.equal(body.identity.ruleVersion, "1.0.0");
      assert.ok(Object.values(body.results).every((result) => (result as { reason?: string }).reason === "unsupported-version"));
      assert.equal((await accessRows(fixture.pool)).length, 1);
    } finally {
      reviewCommandTestSeams.snapshot = undefined;
    }
  });
});

test("R7 migration 0014 to 0015 keeps every row; the access table refuses update, delete and truncate and an unknown submission", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const before = await evidenceFingerprint(pool);
    await migrate(pool);
    assert.equal(await evidenceFingerprint(pool), before);
    assert.equal((await evidence(fixture, taskId)).status, 200);
    const row = (await accessRows(pool))[0]!;
    await assert.rejects(pool.query("UPDATE audit_review_accesses SET actor_id = actor_id"));
    await assert.rejects(pool.query("DELETE FROM audit_review_accesses"));
    await assert.rejects(pool.query("TRUNCATE audit_review_accesses"));
    await assert.rejects(pool.query("INSERT INTO audit_review_accesses (actor_id, task_id, audit_id, submission_id) VALUES ($1, $2, $3, gen_random_uuid())", [owner, row.task_id, row.audit_id]), /foreign key/);
    assert.deepEqual(await accessRows(pool), [row]);
  }, { migrateThrough: "0014_deactivation_recovery" });
});

test("R8 identification, visual checks and comments come back exactly as submitted", async () => {
  await withSyncFixture(async (fixture) => {
    const values = {
      "header.etablissement": "  Établissement  Ñ — 漢字  ",
      "visual.integrity": "Oui",
      "comments.general": "  ligne 1\nligne 2\r\n\tligne 3 é ü — 😀  \n",
      "lightField.comments": "<b>x</b> & \"guillemets\"",
    };
    const { taskId } = await acceptedTask(fixture, values);
    const body = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.deepEqual(body.values, values);
  });
});

test("R9 the response carries no field of another task and another team's Responsable cannot read or alter the log", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture, { "header.reportNumber": "R-PREMIER" });
    const { taskId: other } = await acceptedTask(fixture, { "header.reportNumber": "R-AUTRE" }, fixture.colleague, tokens.colleague);
    const reply = await evidence(fixture, taskId);
    assert.ok(!reply.text.includes(other) && !reply.text.includes("R-AUTRE"));
    const rows = await accessRows(pool);
    assert.equal(rows.length, 1);
    assert.equal((await evidence(fixture, taskId, tokens.otherOwner)).status, 404);
    assert.deepEqual(await accessRows(pool), rows);
  });
});

test("R10 one task set with conflict, correction, replacement and deactivation recovery agrees between the list and the evidence", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee, colleague, tokens, send, newTask } = fixture;

    // Rejected-submission correction.
    const corrected = await newTask(employee);
    const refused = envelope(0, LONE_SURROGATE);
    assert.equal((await send("submissions", corrected, refused)).status, 422);
    assert.equal((await send("submissions", corrected, envelope(0, formPayload({ "header.reportNumber": "R-CORRIGE" }), { correctionOfOperationId: refused.operationId }))).status, 200);

    // Sync conflict resolved by keep-local, then submitted.
    const conflicted = await newTask(employee);
    assert.equal((await send("draft-syncs", conflicted, envelope(0, formPayload({ "header.reportNumber": "R-SERVEUR" })))).status, 200);
    const stale = envelope(0, formPayload({ "header.reportNumber": "R-LOCAL" }));
    assert.equal((await send("draft-syncs", conflicted, stale)).status, 409);
    assert.equal((await send("draft-syncs", conflicted, envelope(1, formPayload({ "header.reportNumber": "R-LOCAL" }), { conflictOperationId: stale.operationId }))).status, 200);
    assert.equal((await send("submissions", conflicted, envelope(2, formPayload({ "header.reportNumber": "R-LOCAL-FINAL" })))).status, 200);

    // Replacement: original accepted, replacement accepted by the colleague.
    const { taskId: original } = await acceptedTask(fixture);
    const replacement = await call(fixture, "POST", `/tasks/${original}/replacements`, tokens.owner, { establishment: "Établissement A", service: "Radiologie", type: "graphie_mobile", assigneeId: colleague });
    assert.equal(replacement.status, 201);
    const replacementId = (replacement.body.task as { id: string }).id;
    assert.equal((await send("submissions", replacementId, envelope(0, formPayload({ "header.reportNumber": "R-REMPLACEMENT" })), tokens.colleague)).status, 200);

    // Deactivation recovery: a synchronized draft of a deactivated Employé becomes new work accepted by the colleague.
    const teamId = (await pool.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [owner])).rows[0]!.id;
    const leaver = await (async () => { const client = await pool.connect(); try { return await account(client, "employe", "Départ Test", teamId); } finally { client.release(); } })();
    const leaverToken = await addSession(pool, leaver);
    const source = await newTask(leaver);
    assert.equal((await send("draft-syncs", source, envelope(0, formPayload({ "header.reportNumber": "R-SOURCE" })), leaverToken)).status, 200);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [leaver]);
    const sourceRow = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.owner)).body).tasks.find((task) => task.id === source)!;
    const recovery = await call(fixture, "POST", `/tasks/${source}/deactivated-assignee-recovery`, tokens.owner, { successorId: colleague, expectedAssignmentVersion: sourceRow.assignmentVersion, sourceRevision: 1 });
    assert.equal(recovery.status, 201);
    const recoveredId = (recovery.body.task as { id: string }).id;
    assert.equal((await send("submissions", recoveredId, envelope(1, formPayload({ "header.reportNumber": "R-RECUPERE" })), tokens.colleague)).status, 200);

    const list = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.owner)).body);
    const accepted = [corrected, conflicted, original, replacementId, recoveredId];
    for (const taskId of accepted) {
      const row = list.tasks.find((task) => task.id === taskId)!;
      assert.equal(row.state, "submitted", taskId);
      const reply = await evidence(fixture, taskId);
      assert.equal(reply.status, 200, taskId);
      const body = acceptedEvidenceResponseSchema.parse(reply.body);
      assert.deepEqual(body.lineage, { replacementOf: row.replacementOf, replacedBy: row.replacedBy, recoverySource: row.recoverySource, recoverySuccessorTaskId: row.recoverySuccessorTaskId }, taskId);
      assert.equal(body.task.assignee, row.assignee, taskId);
    }
    const lineageOf = async (taskId: string) => acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body).lineage;
    const none = { replacementOf: null, replacedBy: null, recoverySource: null, recoverySuccessorTaskId: null };
    assert.deepEqual(await lineageOf(corrected), none, "a correction link is not a replacement or recovery relationship");
    assert.deepEqual(await lineageOf(conflicted), none, "a conflict link is not a replacement or recovery relationship");
    assert.deepEqual(await lineageOf(original), { ...none, replacedBy: replacementId });
    assert.deepEqual(await lineageOf(replacementId), { ...none, replacementOf: original });
    const recoveredAudit = (await pool.query<{ id: string }>("SELECT id FROM audits WHERE task_id = $1", [source])).rows[0]!.id;
    assert.deepEqual(await lineageOf(recoveredId), { ...none, recoverySource: { taskId: source, auditId: recoveredAudit, revision: 1 } });
    // The recovery source has no accepted submission: draft in the list, 404 for the evidence, successor known to the list.
    const sourceAfter = list.tasks.find((task) => task.id === source)!;
    assert.equal(sourceAfter.state, "draft");
    assert.equal(sourceAfter.recoverySuccessorTaskId, recoveredId);
    assert.deepEqual((await evidence(fixture, source)).body, NOT_FOUND);
  });
});

test("R11 the Employé surface is unchanged: no evidence, lineage or access field", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await evidence(fixture, taskId)).status, 200);
    const forbidden = ["evidence", "lineage", "access", "accessedAt", "results", "replacementOf", "replacedBy", "recoverySource"];
    const surfaces = [
      { path: "/employee/tasks", parse: (body: unknown) => employeeTaskListResponseSchema.parse(body) },
      { path: `/employee/tasks/${taskId}`, parse: (body: unknown) => employeeTaskResponseSchema.parse(body) },
      { path: `/employee/tasks/${taskId}/audit-version`, parse: (body: unknown) => employeeTaskAuditVersionSchema.parse(body) },
    ];
    for (const surface of surfaces) {
      const reply = await call(fixture, "GET", surface.path, fixture.tokens.employee);
      assert.equal(reply.status, 200, surface.path);
      surface.parse(reply.body);
      for (const key of forbidden) assert.ok(!reply.text.includes(`"${key}"`), `${surface.path} carries ${key}`);
    }
  });
});
