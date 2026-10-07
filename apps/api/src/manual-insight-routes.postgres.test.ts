import assert from "node:assert/strict";
import test from "node:test";
import { MANUAL_INSIGHT_JUSTIFICATION_MAX, MANUAL_INSIGHT_TEXT_MAX } from "@cetem-qc/domain";
import { acceptedEvidenceResponseSchema, manualInsightResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 9.4: add a manual insight (synthetic names only; the production insight registry is used as is).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cet insight manuel est invalide." } };
const FAILED = { error: { code: "INTERNAL_ERROR", message: "L’insight manuel n’a pas pu être enregistré." } };

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

const add = (fixture: SyncFixture, taskId: string, body: unknown, token: string | null = fixture.tokens.owner) => call(fixture, "POST", `/tasks/${taskId}/manual-insights`, token, body);
const evidence = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner) => call(fixture, "GET", `/tasks/${taskId}/accepted-evidence`, token);

async function acceptedTask(fixture: SyncFixture, values: Record<string, string> = { "header.reportNumber": "R-091" }) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload(values)), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}

type ManualRow = {
  seq: string; id: string; author_id: string; task_id: string; audit_id: string; submission_id: string; revision: number; revision_identity: Record<string, unknown>;
  source_type: string; insight_text: string; justification: string | null; created_at: Date;
};
const manualRows = async (pool: Pool) => (await pool.query<ManualRow>("SELECT * FROM audit_manual_insights ORDER BY seq")).rows;
const accessCount = async (pool: Pool) => Number((await pool.query<{ count: string }>("SELECT count(*) FROM audit_review_accesses")).rows[0]!.count);

async function evidenceFingerprint(pool: Pool): Promise<string> {
  const tables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes",
    "audit_lineage_links", "audit_replacement_links", "audit_deactivated_assignee_recovery_links", "audit_recovery_field_provenance", "audit_insight_decisions"];
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  const result = await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`);
  return result.rows[0]!.fingerprint;
}

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

test("R25 adding returns 201 and inserts exactly one row with every attribution and linkage field", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const before = Date.now();
    const reply = await add(fixture, taskId, { text: "  Câble usé près du statif.  ", justification: "  Constat visuel.  " });
    assert.equal(reply.status, 201);
    assert.match(reply.cacheControl ?? "", /no-store/i);
    const body = manualInsightResponseSchema.parse(reply.body);
    assert.deepEqual([body.text, body.justification, body.sourceType, body.author], ["Câble usé près du statif.", "Constat visuel.", "manual", { id: owner, displayName: "Responsable Test" }]);
    const rows = await manualRows(pool);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    const audit = (await pool.query<{ id: string }>("SELECT id FROM audits WHERE task_id = $1", [taskId])).rows[0]!;
    assert.deepEqual([row.id, row.author_id, row.task_id, row.audit_id, row.submission_id, row.revision, row.source_type, row.insight_text, row.justification],
      [body.id, owner, taskId, audit.id, submissionId, 1, "manual", "Câble usé près du statif.", "Constat visuel."]);
    assert.deepEqual(row.revision_identity, { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" });
    assert.ok(Math.abs(row.created_at.getTime() - before) < 60_000, "the date is the server date");
    assert.equal(body.createdAt, row.created_at.toISOString());
    const blank = await add(fixture, taskId, { text: "Sans justification.", justification: "   " });
    assert.equal(blank.status, 201);
    assert.equal(manualInsightResponseSchema.parse(blank.body).justification, null);
    assert.equal((await manualRows(pool))[1]!.justification, null);
  });
});

test("R26 two adds keep two rows, an open lists them oldest first with author and date, and no other submission lists them", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    const other = await acceptedTask(fixture, { "header.reportNumber": "R-092" });
    assert.equal((await add(fixture, taskId, { text: "Identique" })).status, 201);
    assert.equal((await add(fixture, taskId, { text: "Identique" })).status, 201);
    assert.equal((await manualRows(fixture.pool)).length, 2);
    const opened = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.equal(opened.manualInsights.length, 2);
    const [first, second] = opened.manualInsights as [typeof opened.manualInsights[number], typeof opened.manualInsights[number]];
    assert.ok(first.createdAt <= second.createdAt);
    assert.notEqual(first.id, second.id);
    assert.deepEqual([first.sourceType, first.author.displayName, first.justification], ["manual", "Responsable Test", null]);
    const rows = await manualRows(fixture.pool);
    assert.deepEqual(opened.manualInsights.map((item) => item.id), rows.map((row) => row.id));
    const elsewhere = acceptedEvidenceResponseSchema.parse((await evidence(fixture, other.taskId)).body);
    assert.deepEqual(elsewhere.manualInsights, []);
  });
});

test("R27 refusals write no row and use the documented status and body", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const draftTask = await fixture.newTask(fixture.employee);
    await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-BROUILLON" })));
    const noAudit = await fixture.newTask(fixture.employee);
    const good = { text: "Observation." };
    const refusals = [
      await add(fixture, taskId, good, tokens.employee),
      await add(fixture, "not-a-uuid", good), await add(fixture, "00000000-0000-4000-8000-0000000000aa", good),
      await add(fixture, taskId, good, tokens.otherOwner), await add(fixture, draftTask, good), await add(fixture, noAudit, good),
    ];
    assert.deepEqual(refusals.map((reply) => reply.status), [403, 404, 404, 404, 404, 404]);
    assert.deepEqual(refusals.map((reply) => reply.body), [FORBIDDEN, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND]);
    const evidenceNotFound = await evidence(fixture, "not-a-uuid");
    assert.equal(refusals[1]!.text, evidenceNotFound.text, "byte-identical to 9.1's 404");
    const invalidBodies: unknown[] = [
      {}, { text: "" }, { text: "   " }, { text: "x".repeat(MANUAL_INSIGHT_TEXT_MAX + 1) },
      { text: "ok", justification: "y".repeat(MANUAL_INSIGHT_JUSTIFICATION_MAX + 1) },
      { text: "ok", authorId: "x" }, { text: "ok", createdAt: "2020-01-01T00:00:00.000Z" }, { text: "ok", sourceType: "manual" }, { text: 12 },
    ];
    for (const body of invalidBodies) {
      const reply = await add(fixture, taskId, body);
      assert.deepEqual([reply.status, reply.body], [422, INVALID], JSON.stringify(body).slice(0, 40));
    }
    assert.deepEqual((await add(fixture, "00000000-0000-4000-8000-0000000000aa", { text: "" })).body, NOT_FOUND, "an invalid body never reveals whether a task exists");
    reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, identity: { ...snapshot.identity, ruleVersion: "1.0.0" } });
    try {
      const inconsistent = await add(fixture, taskId, good);
      assert.deepEqual([inconsistent.status, inconsistent.body], [500, FAILED]);
    } finally { reviewCommandTestSeams.snapshot = undefined; }
    assert.equal((await manualRows(pool)).length, 0);
    const limits = await add(fixture, taskId, { text: "x".repeat(MANUAL_INSIGHT_TEXT_MAX), justification: "y".repeat(MANUAL_INSIGHT_JUSTIFICATION_MAX) });
    assert.equal(limits.status, 201, "values at the limits are accepted");
  });
});

test("R28 UPDATE, DELETE and TRUNCATE on audit_manual_insights are refused", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await add(fixture, taskId, { text: "Conservé." })).status, 201);
    for (const statement of ["UPDATE audit_manual_insights SET insight_text = 'x'", "DELETE FROM audit_manual_insights", "TRUNCATE audit_manual_insights"]) {
      await assert.rejects(fixture.pool.query(statement), (error: Error) => error.message.length > 0, statement);
    }
    assert.deepEqual((await manualRows(fixture.pool)).map((row) => row.insight_text), ["Conservé."]);
  });
});

test("K15 the migration length checks equal the domain constants", async () => {
  await withSyncFixture(async (fixture) => {
    const checks = (await fixture.pool.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'audit_manual_insights'::regclass AND contype = 'c'",
    )).rows.map((row) => row.definition);
    assert.ok(checks.some((definition) => definition.includes("insight_text") && definition.includes(`${MANUAL_INSIGHT_TEXT_MAX}`)));
    assert.ok(checks.some((definition) => definition.includes("justification") && definition.includes(`${MANUAL_INSIGHT_JUSTIFICATION_MAX}`)));
  });
});

test("R29 adds leave the evidence tables, the decision table and tasks.updated_at byte-identical and write no access row", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await evidence(fixture, taskId)).status, 200);
    assert.equal(await accessCount(fixture.pool), 1);
    const before = await evidenceFingerprint(fixture.pool);
    for (const text of ["Un", "Deux", "Trois"]) assert.equal((await add(fixture, taskId, { text })).status, 201);
    assert.equal(await evidenceFingerprint(fixture.pool), before);
    assert.equal(await accessCount(fixture.pool), 1, "adds write no access row");
    assert.equal((await evidence(fixture, taskId)).status, 200);
    assert.equal(await accessCount(fixture.pool), 2, "an open still writes exactly one");
    assert.equal(await evidenceFingerprint(fixture.pool), before);
  });
});

test("R30 zero manual insights leaves the open working and refusal log lines carry the actor ID and class only", async () => {
  await withSyncFixture(async (fixture) => {
    const { owner, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture, { "header.reportNumber": "R-SECRET-VALUE" });
    const opened = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.deepEqual(opened.manualInsights, []);
    const { lines } = await captureInfo(async () => {
      await add(fixture, taskId, { text: "TEXTE-SECRET", justification: "JUSTIF-SECRET" }, tokens.employee);
      await add(fixture, taskId, { text: "TEXTE-SECRET" }, tokens.otherOwner);
      await add(fixture, taskId, { text: "" });
      await add(fixture, taskId, { text: "TEXTE-SECRET", justification: "JUSTIF-SECRET" });
    });
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(parsed.map((line) => line.class), ["forbidden-role", "not-found", "validation"]);
    assert.ok(parsed.every((line) => line.event === "audit.manual_insight_refused" && typeof line.actorId === "string"));
    assert.equal(parsed[2]!.actorId, owner);
    for (const line of lines) assert.ok(!line.includes(taskId) && !line.includes("SECRET"));
  });
});

test("R31 text containing markup or script is stored and returned verbatim", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    const text = "<script>alert('x')</script> **gras** <b>";
    const reply = await add(fixture, taskId, { text, justification: "<img src=x onerror=1>" });
    assert.equal(reply.status, 201);
    assert.equal((await manualRows(fixture.pool))[0]!.insight_text, text);
    const opened = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.deepEqual([opened.manualInsights[0]!.text, opened.manualInsights[0]!.justification], [text, "<img src=x onerror=1>"]);
  });
});
