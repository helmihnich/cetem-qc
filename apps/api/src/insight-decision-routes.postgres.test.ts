import assert from "node:assert/strict";
import test from "node:test";
import { acceptedEvidenceResponseSchema, insightDecisionResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 9.3: retain or discard proposed insights with provenance (synthetic names and registries only).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cette décision d’insight est invalide." } };
const FAILED = { error: { code: "INTERNAL_ERROR", message: "La décision n’a pas pu être enregistrée." } };

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

const decide = (fixture: SyncFixture, taskId: string, body: unknown, token: string | null = fixture.tokens.owner) => call(fixture, "POST", `/tasks/${taskId}/insight-decisions`, token, body);
const evidence = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner) => call(fixture, "GET", `/tasks/${taskId}/accepted-evidence`, token);

async function acceptedTask(fixture: SyncFixture, values: Record<string, string> = { "header.reportNumber": "R-091" }) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload(values)), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}

const syntheticRule = (ruleId: string, keyField = "header.reportNumber") => ({
  ruleId, ruleVersion: 1, approvalReference: "Document de test synthétique", sources: [{ kind: "field" as const, key: keyField }],
  evaluate: (input: { values: Readonly<Record<string, string>> }) => [{ sourceKeys: [{ kind: "field" as const, key: keyField }], params: { numero: input.values[keyField] ?? "" } }],
});
const withSyntheticRegistry = async <T,>(run: () => Promise<T>, ruleIds = ["regle-synthetique"]): Promise<T> => {
  reviewCommandTestSeams.insightRegistry = {
    rules: ruleIds.map((ruleId) => syntheticRule(ruleId)),
    templates: Object.fromEntries(ruleIds.map((ruleId) => [ruleId, `Rapport {numero} (${ruleId}).`])),
  };
  try { return await run(); } finally { reviewCommandTestSeams.insightRegistry = undefined; }
};
const proposalIdOf = (ruleId: string, submissionId: string) => `${ruleId}:v1:${submissionId}:field=header.reportNumber`;

type DecisionRow = {
  seq: string; actor_id: string; task_id: string; audit_id: string; submission_id: string; revision: number; revision_identity: Record<string, unknown>;
  proposal_id: string; decision: string; proposal: Record<string, unknown>; decided_at: Date;
};
const decisionRows = async (pool: Pool) => (await pool.query<DecisionRow>("SELECT * FROM audit_insight_decisions ORDER BY seq")).rows;
const accessCount = async (pool: Pool) => Number((await pool.query<{ count: string }>("SELECT count(*) FROM audit_review_accesses")).rows[0]!.count);

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
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

test("R17 retaining a proposal returns 200 and inserts exactly one row with every provenance field", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const proposalId = proposalIdOf("regle-synthetique", submissionId);
    await withSyntheticRegistry(async () => {
      const before = Date.now();
      const reply = await decide(fixture, taskId, { proposalId, decision: "retained" });
      assert.equal(reply.status, 200);
      assert.match(reply.cacheControl ?? "", /no-store/i);
      const body = insightDecisionResponseSchema.parse(reply.body);
      assert.deepEqual([body.proposalId, body.decision, body.decidedBy], [proposalId, "retained", { id: owner, displayName: "Responsable Test" }]);
      const rows = await decisionRows(pool);
      assert.equal(rows.length, 1);
      const row = rows[0]!;
      const audit = (await pool.query<{ id: string }>("SELECT id FROM audits WHERE task_id = $1", [taskId])).rows[0]!;
      assert.deepEqual([row.actor_id, row.task_id, row.audit_id, row.submission_id, row.revision, row.proposal_id, row.decision], [owner, taskId, audit.id, submissionId, 1, proposalId, "retained"]);
      assert.deepEqual(row.revision_identity, { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" });
      assert.deepEqual(row.proposal, {
        proposalId, ruleId: "regle-synthetique", ruleVersion: 1, approvalReference: "Document de test synthétique", registryVersion: "insight-registry-1",
        submissionId, sourceKeys: [{ kind: "field", key: "header.reportNumber" }], statement: "Rapport R-091 (regle-synthetique).", origin: "deterministic",
      });
      assert.ok(Math.abs(row.decided_at.getTime() - before) < 60_000, "the date is the server date");
      assert.equal(body.decidedAt, row.decided_at.toISOString());
    });
  });
});

test("R18 discarding then retaining keeps both rows, the later one is current, and an open reports it", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId, submissionId } = await acceptedTask(fixture);
    const proposalId = proposalIdOf("regle-synthetique", submissionId);
    await withSyntheticRegistry(async () => {
      assert.equal((await decide(fixture, taskId, { proposalId, decision: "discarded" })).status, 200);
      const opened = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
      assert.deepEqual(opened.insightDecisions.map((item) => item.decision), ["discarded"]);
      assert.equal((await decide(fixture, taskId, { proposalId, decision: "retained" })).status, 200);
      const rows = await decisionRows(fixture.pool);
      assert.deepEqual(rows.map((row) => row.decision), ["discarded", "retained"]);
      const reopened = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
      assert.equal(reopened.insightDecisions.length, 1);
      const current = reopened.insightDecisions[0]!;
      assert.deepEqual([current.proposalId, current.decision, current.decidedBy.displayName, current.registryVersion, current.ruleId, current.ruleVersion],
        [proposalId, "retained", "Responsable Test", "insight-registry-1", "regle-synthetique", 1]);
      assert.equal(current.decidedAt, rows[1]!.decided_at.toISOString());
    });
  });
});

test("R19 refusals write no row and use the documented status and body", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, tokens } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const draftTask = await fixture.newTask(fixture.employee);
    await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-BROUILLON" })));
    const noAudit = await fixture.newTask(fixture.employee);
    const good = { proposalId: proposalIdOf("regle-synthetique", submissionId), decision: "retained" };
    await withSyntheticRegistry(async () => {
      const refusals = [
        await decide(fixture, taskId, good, tokens.employee),
        await decide(fixture, "not-a-uuid", good), await decide(fixture, "00000000-0000-4000-8000-0000000000aa", good),
        await decide(fixture, taskId, good, tokens.otherOwner), await decide(fixture, draftTask, good), await decide(fixture, noAudit, good),
      ];
      assert.deepEqual(refusals.map((reply) => reply.status), [403, 404, 404, 404, 404, 404]);
      assert.deepEqual(refusals.map((reply) => reply.body), [FORBIDDEN, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND]);
      const evidenceNotFound = (await evidence(fixture, "not-a-uuid")).body;
      assert.deepEqual(refusals[1]!.body, evidenceNotFound, "identical to 9.1's 404");
      const unknown = await decide(fixture, taskId, { proposalId: "inconnue", decision: "retained" });
      const invalid = await decide(fixture, taskId, { proposalId: good.proposalId, decision: "approved" });
      const missing = await decide(fixture, taskId, { decision: "retained" });
      assert.deepEqual([unknown.status, invalid.status, missing.status], [422, 422, 422]);
      assert.deepEqual([unknown.body, invalid.body, missing.body], [INVALID, INVALID, INVALID]);
      assert.deepEqual((await decide(fixture, "00000000-0000-4000-8000-0000000000aa", { decision: "x" })).body, NOT_FOUND, "an invalid body never reveals whether a task exists");
      reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, identity: { ...snapshot.identity, ruleVersion: "1.0.0" } });
      try {
        const inconsistent = await decide(fixture, taskId, good);
        assert.deepEqual([inconsistent.status, inconsistent.body], [500, FAILED]);
      } finally { reviewCommandTestSeams.snapshot = undefined; }
    });
    assert.equal((await decisionRows(pool)).length, 0);
  });
});

test("R20 with the production registry every decision is refused 422 and an open returns no decisions", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId, submissionId } = await acceptedTask(fixture);
    for (const proposalId of [proposalIdOf("regle-synthetique", submissionId), "x"]) {
      const reply = await decide(fixture, taskId, { proposalId, decision: "retained" });
      assert.deepEqual([reply.status, reply.body], [422, INVALID]);
    }
    assert.equal((await decisionRows(fixture.pool)).length, 0);
    const opened = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.deepEqual(opened.insightDecisions, []);
    assert.equal(opened.insights.status, "unavailable");
  });
});

test("R21 UPDATE, DELETE and TRUNCATE on audit_insight_decisions are refused", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId, submissionId } = await acceptedTask(fixture);
    await withSyntheticRegistry(async () => { assert.equal((await decide(fixture, taskId, { proposalId: proposalIdOf("regle-synthetique", submissionId), decision: "retained" })).status, 200); });
    for (const statement of ["UPDATE audit_insight_decisions SET decision = 'discarded'", "DELETE FROM audit_insight_decisions", "TRUNCATE audit_insight_decisions"]) {
      await assert.rejects(fixture.pool.query(statement), (error: Error) => error.message.length > 0, statement);
    }
    assert.deepEqual((await decisionRows(fixture.pool)).map((row) => row.decision), ["retained"]);
  });
});

test("R22 decisions leave the evidence tables and tasks.updated_at byte-identical and write no access row", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId, submissionId } = await acceptedTask(fixture);
    await withSyntheticRegistry(async () => {
      assert.equal((await evidence(fixture, taskId)).status, 200);
      assert.equal(await accessCount(fixture.pool), 1);
      const before = await evidenceFingerprint(fixture.pool);
      const proposalId = proposalIdOf("regle-synthetique", submissionId);
      for (const decision of ["retained", "discarded", "retained"]) assert.equal((await decide(fixture, taskId, { proposalId, decision })).status, 200);
      assert.equal(await evidenceFingerprint(fixture.pool), before);
      assert.equal(await accessCount(fixture.pool), 1, "decisions write no access row");
      assert.equal((await evidence(fixture, taskId)).status, 200);
      assert.equal(await accessCount(fixture.pool), 2, "an open still writes exactly one");
      assert.equal(await evidenceFingerprint(fixture.pool), before);
    });
  });
});

test("R23 a decision body carrying proposal content is refused and the stored statement is the server's", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId, submissionId } = await acceptedTask(fixture);
    const proposalId = proposalIdOf("regle-synthetique", submissionId);
    await withSyntheticRegistry(async () => {
      const forged = await decide(fixture, taskId, { proposalId, decision: "retained", statement: "Texte fabriqué", proposal: { statement: "Texte fabriqué" } });
      assert.deepEqual([forged.status, forged.body], [422, INVALID]);
      assert.equal((await decisionRows(fixture.pool)).length, 0);
      assert.equal((await decide(fixture, taskId, { proposalId, decision: "retained" })).status, 200);
      assert.equal((await decisionRows(fixture.pool))[0]!.proposal.statement, "Rapport R-091 (regle-synthetique).");
    });
  });
});

test("R24 zero decisions or all discarded blocks nothing, and refusal log lines carry the actor ID and class only", async () => {
  await withSyncFixture(async (fixture) => {
    const { owner, tokens } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture, { "header.reportNumber": "R-SECRET-VALUE" });
    const proposalId = proposalIdOf("regle-synthetique", submissionId);
    await withSyntheticRegistry(async () => {
      assert.equal((await evidence(fixture, taskId)).status, 200, "zero decisions");
      assert.equal((await decide(fixture, taskId, { proposalId, decision: "discarded" })).status, 200);
      const opened = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
      assert.deepEqual(opened.insightDecisions.map((item) => item.decision), ["discarded"]);
      const { lines } = await captureInfo(async () => {
        await decide(fixture, taskId, { proposalId, decision: "retained" }, tokens.employee);
        await decide(fixture, taskId, { proposalId, decision: "retained" }, tokens.otherOwner);
        await decide(fixture, taskId, { proposalId: "inconnue", decision: "retained" });
      });
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.deepEqual(parsed.map((line) => line.class), ["forbidden-role", "not-found", "validation"]);
      assert.ok(parsed.every((line) => line.event === "audit.insight_decision_refused" && typeof line.actorId === "string"));
      assert.equal(parsed[2]!.actorId, owner);
      for (const line of lines) assert.ok(!line.includes(taskId) && !line.includes(proposalId) && !line.includes("SECRET") && !line.includes("inconnue"));
    });
  });
});
