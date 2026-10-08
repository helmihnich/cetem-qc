import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { acceptedEvidenceResponseSchema, conformityDecisionSchema, confirmedSummarySchema } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { getCurrentConformityDecision, getConformityHistory } from "./modules/conformity/index.js";
import { summaryCommandTestSeams } from "./modules/summaries/commands/request-summary-draft.js";
import { listSummaryReopenParticipants, registerSummaryReopenParticipant, summaryReopenParticipantTestSeams } from "./modules/summaries/index.js";
import type { SummaryReopenParticipant } from "./modules/summaries/index.js";
import { registerDefaultSummaryReopenParticipants } from "./register-participants.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 10.4: the explicit human machine-conformity decision (synthetic names, mock provider; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cette décision est invalide." } };
const FAILED = { error: { code: "INTERNAL_ERROR", message: "La décision n’a pas pu être enregistrée." } };
const NOT_CONFIRMED = { error: { code: "SUMMARY_NOT_CONFIRMED", message: "La synthèse n’est pas confirmée : la décision ne peut pas être enregistrée." } };
const ALREADY = { error: { code: "CONFORMITY_ALREADY_DECIDED", message: "Une décision est déjà enregistrée pour cette synthèse." } };
const DESIGNATED = { error: { code: "SUMMARY_DESIGNATED", message: "Un rapport officiel est désigné : la synthèse ne peut plus être rouverte." } };

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

const confirm = (fixture: SyncFixture, taskId: string, text = "Synthèse finale.") => call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, fixture.tokens.owner, { text });
const reopen = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/summary-reopening`, fixture.tokens.owner, {});
const record = (fixture: SyncFixture, taskId: string, body: unknown = { outcome: "machine-conforme" }, token: string | null = fixture.tokens.owner) =>
  call(fixture, "POST", `/tasks/${taskId}/conformity-decision`, token, body);
const evidence = (fixture: SyncFixture, taskId: string) => call(fixture, "GET", `/tasks/${taskId}/accepted-evidence`, fixture.tokens.owner);

async function acceptedTask(fixture: SyncFixture, values: Record<string, string> = { "header.reportNumber": "R-101" }) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload(values)), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}

interface DecisionRow { id: string; confirmed_summary_id: string; outcome: string; decided_by: string; task_id: string; submission_id: string; decided_at: Date }
const decisionRows = async (pool: Pool) => (await pool.query<DecisionRow>("SELECT * FROM conformity_decisions ORDER BY seq")).rows;
const invalidationRows = async (pool: Pool) => (await pool.query<{ decision_id: string; reopened_summary_id: string; invalidated_by: string; invalidated_at: Date }>("SELECT * FROM conformity_decision_invalidations ORDER BY seq")).rows;
const decisionText = async (pool: Pool) => (await pool.query<{ t: string }>("SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY seq), '[]'::jsonb)::text AS t FROM conformity_decisions d")).rows[0]!.t;

async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const protectedTables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes",
  "audit_lineage_links", "audit_replacement_links", "audit_deactivated_assignee_recovery_links", "audit_recovery_field_provenance",
  "audit_insight_decisions", "audit_manual_insights", "audit_review_accesses", "summary_ai_drafts", "confirmed_summaries", "summary_reopenings"];

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

const participant = (name: string, overrides: Partial<SummaryReopenParticipant> = {}): SummaryReopenParticipant => ({
  name, hasOfficialDesignation: async () => false, onSummaryReopened: async () => undefined, ...overrides,
});
/** Adds synthetic participants after the production ones and always clears the registry afterwards. */
async function withParticipants<T>(participants: SummaryReopenParticipant[], run: () => Promise<T>): Promise<T> {
  for (const synthetic of participants) registerSummaryReopenParticipant(synthetic);
  try { return await run(); } finally { summaryReopenParticipantTestSeams.clear(); registerDefaultSummaryReopenParticipants(); }
}

test("R65 confirm then record either outcome returns 201 bound to the confirmed summary; one row with actor, server date, task and submission", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    for (const outcome of ["machine-conforme", "machine-non-conforme"] as const) {
      const { taskId, submissionId } = await acceptedTask(fixture, { "header.reportNumber": `R-${outcome}` });
      const summary = confirmedSummarySchema.parse((await confirm(fixture, taskId)).body);
      const before = Date.now();
      const reply = await record(fixture, taskId, { outcome });
      assert.equal(reply.status, 201);
      assert.match(reply.cacheControl ?? "", /no-store/i);
      const body = conformityDecisionSchema.parse(reply.body);
      assert.deepEqual([body.outcome, body.summaryId, body.summaryVersion, body.decidedBy], [outcome, summary.id, 1, { id: owner, displayName: "Responsable Test" }]);
      const row = (await decisionRows(pool)).find((candidate) => candidate.id === body.id)!;
      assert.deepEqual([row.confirmed_summary_id, row.outcome, row.decided_by, row.task_id, row.submission_id], [summary.id, outcome, owner, taskId, submissionId]);
      assert.equal(row.decided_at.toISOString(), body.decidedAt);
      assert.ok(Math.abs(row.decided_at.getTime() - before) < 60_000, "the date is the server date");
      const shown = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
      assert.deepEqual(shown.conformityDecision, body);
      assert.deepEqual(shown.conformityHistory, []);
    }
    assert.equal((await decisionRows(pool)).length, 2);
  });
});

test("R66 independence: whatever the results, both outcomes are accepted and the command reads nothing but the outcome", async () => {
  await withSyncFixture(async (fixture) => {
    const fixtures: Array<Record<string, string>> = [
      { "header.reportNumber": "R-I1" },
      { "header.reportNumber": "R-I2", "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2" },
      { "header.reportNumber": "R-I3", "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "20" },
      { "header.reportNumber": "R-I4", "voltage.repeatability.row1.kvMeasured": "69,7", "voltage.repeatability.row1.kerma": "2,677", "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,9" },
    ];
    const shapes = new Set<string>();
    let index = 0;
    for (const values of fixtures) {
      for (const outcome of ["machine-conforme", "machine-non-conforme"] as const) {
        const { taskId } = await acceptedTask(fixture, { ...values, "header.reportNumber": `${values["header.reportNumber"]}-${index++}` });
        assert.equal((await confirm(fixture, taskId)).status, 201);
        const reply = await record(fixture, taskId, { outcome });
        assert.equal(reply.status, 201, JSON.stringify(values));
        shapes.add(Object.keys(reply.body).sort().join(","));
      }
    }
    assert.equal(shapes.size, 1, "response shape is identical whatever the verdicts");
  });
  const source = readFileSync(join(process.cwd(), "src", "modules", "conformity", "commands", "record-conformity-decision.ts"), "utf8");
  for (const forbidden of ["audit_insight_decisions", "audit_manual_insights", "summary_ai_drafts", "createSummaryDraftProvider", "calculateGraphie", "final_text"]) {
    assert.ok(!source.includes(forbidden), forbidden);
  }
  assert.match(source, /outcome: ConformityOutcome,\s*\): Promise/);
});

test("R67 never confirmed, or reopened and not yet reconfirmed, gives 409 SUMMARY_NOT_CONFIRMED and no row", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const never = await record(fixture, taskId);
    assert.deepEqual([never.status, never.body], [409, NOT_CONFIRMED]);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    assert.equal((await reopen(fixture, taskId)).status, 201);
    const open = await record(fixture, taskId, { outcome: "machine-non-conforme" });
    assert.deepEqual([open.status, open.body], [409, NOT_CONFIRMED]);
    assert.equal((await decisionRows(pool)).length, 0);
  });
});

test("R68 a missing, unknown or null outcome, an extra property or a non-object body gives 422 and no row; no default is applied", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    for (const body of [{}, { outcome: "conforme" }, { outcome: null }, { outcome: "machine-conforme", reason: "x" }, { outcome: 1 }, []]) {
      const reply = await record(fixture, taskId, body);
      assert.deepEqual([reply.status, reply.body], [422, INVALID], JSON.stringify(body));
    }
    // Bodies that are not a JSON object or array never reach the route: the shared JSON parser answers 400.
    for (const raw of ["null", "\"machine-conforme\"", "{"]) {
      const response = await fetch(`${fixture.apiRoot}/tasks/${taskId}/conformity-decision`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${fixture.tokens.owner}` }, body: raw });
      assert.equal(response.status, 400, raw);
    }
    assert.equal((await decisionRows(pool)).length, 0);
    const column = await pool.query<{ column_default: string | null }>("SELECT column_default FROM information_schema.columns WHERE table_name = 'conformity_decisions' AND column_name = 'outcome' AND table_schema = current_schema()");
    assert.equal(column.rows[0]!.column_default, null, "the outcome has no default in the database");
  });
});

test("R69 a second record for the same summary gives 409 and leaves the first row byte-identical; two concurrent records leave one row", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    assert.equal((await record(fixture, taskId, { outcome: "machine-conforme" })).status, 201);
    const rows = await decisionText(pool);
    for (const outcome of ["machine-conforme", "machine-non-conforme"]) {
      const again = await record(fixture, taskId, { outcome });
      assert.deepEqual([again.status, again.body], [409, ALREADY]);
    }
    assert.equal(await decisionText(pool), rows);

    const racing = await acceptedTask(fixture, { "header.reportNumber": "R-102" });
    assert.equal((await confirm(fixture, racing.taskId)).status, 201);
    const replies = await Promise.all([record(fixture, racing.taskId, { outcome: "machine-conforme" }), record(fixture, racing.taskId, { outcome: "machine-non-conforme" })]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [201, 409]);
    assert.equal((await decisionRows(pool)).filter((row) => row.task_id === racing.taskId).length, 1);
  });
});

test("R70 reopening after a decision writes one invalidation row in the reopening; the decision becomes history and is byte-identical", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const summary = confirmedSummarySchema.parse((await confirm(fixture, taskId)).body);
    const decision = conformityDecisionSchema.parse((await record(fixture, taskId, { outcome: "machine-non-conforme" })).body);
    const rows = await decisionText(pool);
    const reopening = (await reopen(fixture, taskId)).body as { reopenedAt: string };
    const invalidations = await invalidationRows(pool);
    assert.equal(invalidations.length, 1);
    assert.deepEqual([invalidations[0]!.decision_id, invalidations[0]!.reopened_summary_id, invalidations[0]!.invalidated_by], [decision.id, summary.id, owner]);
    assert.equal(invalidations[0]!.invalidated_at.toISOString(), reopening.reopenedAt);
    assert.equal(await decisionText(pool), rows, "the decision row is untouched");
    assert.equal(await getCurrentConformityDecision(pool, submissionId), null);
    const body = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.equal(body.conformityDecision, null);
    assert.deepEqual(body.conformityHistory, [{ ...decision, invalidatedAt: reopening.reopenedAt }]);
    assert.deepEqual(await getConformityHistory(pool, submissionId), body.conformityHistory);
  });
});

test("R71 reopening without a decision writes no invalidation; after reconfirmation a new decision is current and the old one only history", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    assert.equal((await reopen(fixture, taskId)).status, 201);
    assert.equal((await invalidationRows(pool)).length, 0);
    assert.equal((await confirm(fixture, taskId, "Version deux.")).status, 201);
    const first = conformityDecisionSchema.parse((await record(fixture, taskId, { outcome: "machine-conforme" })).body);
    assert.equal(first.summaryVersion, 2);
    assert.equal((await reopen(fixture, taskId)).status, 201);
    const afterReopen = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.equal(afterReopen.conformityDecision, null, "the prior outcome is not carried over or preselected");
    assert.equal((await confirm(fixture, taskId, "Version trois.")).status, 201);
    const reconfirmed = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.equal(reconfirmed.conformityDecision, null, "no inferred decision for the next version");
    const second = conformityDecisionSchema.parse((await record(fixture, taskId, { outcome: "machine-non-conforme" })).body);
    assert.equal(second.summaryVersion, 3);
    const body = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.deepEqual(body.conformityDecision, second);
    assert.deepEqual(body.conformityHistory.map((item) => [item.id, item.outcome, item.summaryVersion, item.invalidatedAt !== null]), [[first.id, "machine-conforme", 2, true]]);
    assert.equal((await decisionRows(pool)).length, 2);
  });
});

test("R72 binding is the authority: without the invalidation row a decision of an older summary is still never current", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    const decision = conformityDecisionSchema.parse((await record(fixture, taskId)).body);
    assert.equal((await reopen(fixture, taskId)).status, 201);
    await pool.query("ALTER TABLE conformity_decision_invalidations DISABLE TRIGGER USER");
    await pool.query("DELETE FROM conformity_decision_invalidations");
    await pool.query("ALTER TABLE conformity_decision_invalidations ENABLE TRIGGER USER");
    assert.equal((await invalidationRows(pool)).length, 0);
    assert.equal(await getCurrentConformityDecision(pool, submissionId), null, "open summary");
    assert.equal((await confirm(fixture, taskId, "Nouvelle version.")).status, 201);
    assert.equal(await getCurrentConformityDecision(pool, submissionId), null, "reconfirmed summary has another id");
    const history = await getConformityHistory(pool, submissionId);
    assert.deepEqual(history.map((item) => [item.id, item.invalidatedAt]), [[decision.id, null]]);
    assert.equal(acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body).conformityDecision, null);
  });
});

test("R73 a concurrent reopen and record end consistent: never a current decision on an open summary", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    for (let round = 0; round < 4; round++) {
      const { taskId, submissionId } = await acceptedTask(fixture, { "header.reportNumber": `R-C${round}` });
      assert.equal((await confirm(fixture, taskId)).status, 201);
      const [reopened, recorded] = await Promise.all([reopen(fixture, taskId), record(fixture, taskId)]);
      assert.equal(reopened.status, 201);
      assert.ok([201, 409].includes(recorded.status));
      assert.equal(await getCurrentConformityDecision(pool, submissionId), null);
      const rows = (await decisionRows(pool)).filter((row) => row.task_id === taskId);
      const invalidated = (await invalidationRows(pool)).filter((row) => rows.some((decision) => decision.id === row.decision_id));
      if (recorded.status === 201) {
        assert.equal(rows.length, 1);
        assert.equal(invalidated.length, 1, "the record won and was then invalidated by the reopening");
      } else {
        assert.deepEqual(recorded.body, NOT_CONFIRMED);
        assert.equal(rows.length, 0);
      }
    }
  });
});

test("R74 a throwing participant after conformity rolls the reopening back; a designation veto leaves the decision current and invalidates nothing", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    const decision = conformityDecisionSchema.parse((await record(fixture, taskId)).body);
    await withParticipants([participant("defaillant", { onSummaryReopened: async () => { throw new Error("forced"); } })], async () => {
      const reply = await reopen(fixture, taskId);
      assert.equal(reply.status, 500);
    });
    assert.equal((await pool.query("SELECT 1 FROM summary_reopenings")).rows.length, 0);
    assert.equal((await invalidationRows(pool)).length, 0, "the invalidation written before the failure is rolled back");
    assert.deepEqual(await getCurrentConformityDecision(pool, submissionId), decision);
    await withParticipants([participant("rapports", { hasOfficialDesignation: async () => true })], async () => {
      const reply = await reopen(fixture, taskId);
      assert.deepEqual([reply.status, reply.body], [409, DESIGNATED]);
    });
    assert.equal((await invalidationRows(pool)).length, 0);
    assert.deepEqual(await getCurrentConformityDecision(pool, submissionId), decision);
  });
});

test("R75 registering the default participants twice does not throw and registers conformity and reports once", () => {
  summaryReopenParticipantTestSeams.clear();
  try {
    registerDefaultSummaryReopenParticipants();
    assert.doesNotThrow(() => registerDefaultSummaryReopenParticipants());
    assert.deepEqual(listSummaryReopenParticipants().map((entry) => entry.name), ["conformity", "reports"]);
  } finally { summaryReopenParticipantTestSeams.clear(); registerDefaultSummaryReopenParticipants(); }
});

test("R76 refusals write nothing and use the documented status and body", async () => {
  await withSyncFixture(async (fixture) => {
    const { tokens, pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    const draftTask = await fixture.newTask(fixture.employee);
    await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-BROUILLON" })));
    const noAudit = await fixture.newTask(fixture.employee);
    const refusals = [
      await record(fixture, taskId, undefined, tokens.employee),
      await record(fixture, "not-a-uuid"), await record(fixture, "00000000-0000-4000-8000-0000000000aa"),
      await record(fixture, taskId, undefined, tokens.otherOwner), await record(fixture, draftTask), await record(fixture, noAudit),
    ];
    assert.deepEqual(refusals.map((reply) => reply.status), [403, 404, 404, 404, 404, 404]);
    assert.deepEqual(refusals.map((reply) => reply.body), [FORBIDDEN, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND]);
    assert.equal(refusals[1]!.text, (await evidence(fixture, "not-a-uuid")).text, "byte-identical to 9.1's 404");
    assert.equal((await record(fixture, taskId, undefined, null)).status, 401);
    assert.deepEqual((await record(fixture, "00000000-0000-4000-8000-0000000000aa", {})).body, NOT_FOUND, "an invalid body never reveals whether a task exists");
    assert.equal((await decisionRows(pool)).length, 0);
    const second = await acceptedTask(fixture, { "header.reportNumber": "R-103" });
    assert.equal((await confirm(fixture, second.taskId)).status, 201);
    reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, identity: { ...snapshot.identity, ruleVersion: "1.0.0" } });
    try {
      const inconsistent = await record(fixture, second.taskId);
      assert.deepEqual([inconsistent.status, inconsistent.body], [500, FAILED]);
    } finally { reviewCommandTestSeams.snapshot = undefined; }
    assert.equal((await decisionRows(pool)).length, 0);
  });
});

test("R77 recording writes only the decision row, changes no other table or tasks.updated_at, and calls no provider", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    assert.equal((await evidence(fixture, taskId)).status, 200);
    const before = await fingerprint(fixture.pool, protectedTables);
    let providerCalls = 0;
    summaryCommandTestSeams.provider = { name: "fake", model: "fake-model", generate: async () => { providerCalls++; return "x"; } };
    try {
      assert.equal((await record(fixture, taskId)).status, 201);
    } finally { summaryCommandTestSeams.provider = undefined; }
    assert.equal(providerCalls, 0);
    assert.equal(await fingerprint(fixture.pool, protectedTables), before);
    assert.equal((await decisionRows(fixture.pool)).length, 1);
  });
});

test("R78 log lines carry the event, the actor ID and a fixed class only: no task or decision ID and no outcome", async () => {
  await withSyncFixture(async (fixture) => {
    const { owner, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture, { "header.reportNumber": "R-SECRET-VALUE" });
    let decisionId = "";
    const { lines } = await captureInfo(async () => {
      await record(fixture, taskId);
      await confirm(fixture, taskId, "TEXTE-SECRET");
      await record(fixture, taskId, undefined, tokens.employee);
      await record(fixture, taskId, undefined, tokens.otherOwner);
      decisionId = String((await record(fixture, taskId, { outcome: "machine-non-conforme" })).body.id);
      await record(fixture, taskId);
    });
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => String(line.event).startsWith("conformity."));
    assert.deepEqual(events.map((line) => [line.event, line.class ?? null]), [
      ["conformity.refused", "not-confirmed"], ["conformity.refused", "forbidden-role"], ["conformity.refused", "not-found"],
      ["conformity.recorded", null], ["conformity.refused", "already-decided"],
    ]);
    assert.deepEqual(Object.keys(events[3]!).sort(), ["actorId", "event"]);
    assert.equal(events[3]!.actorId, owner);
    for (const line of lines) for (const secret of [taskId, decisionId, "SECRET", "machine-"]) assert.ok(!line.includes(secret), `${secret} in ${line}`);
  });
});

test("R80 the summaries module references no conformity code or table", () => {
  const root = join(process.cwd(), "src", "modules", "summaries");
  const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
  for (const file of sources(root)) assert.ok(!/conformity/i.test(readFileSync(file, "utf8").replace(/\b(?:10\.4|conformity decision in 10\.4)\b/g, "").replace(/\/\*\*[\s\S]*?\*\//g, "")), `${file} must not reference conformity`);
});

test("K30 migration 0021: no default or invalid outcome, one decision per summary, one invalidation per decision, insert-only", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    const insert = (outcome: string | null) => pool.query(
      "INSERT INTO conformity_decisions (confirmed_summary_id, outcome, decided_by, task_id, submission_id) SELECT id, $2, $1, task_id, submission_id FROM confirmed_summaries LIMIT 1", [owner, outcome]);
    await assert.rejects(insert(null), /outcome/, "no default");
    await assert.rejects(insert("conforme"), /outcome|check/i, "CHECK refuses other values");
    await insert("machine-conforme");
    await assert.rejects(insert("machine-non-conforme"), /confirmed_summary_id|unique/i, "one decision per confirmed summary");
    const invalidate = () => pool.query(
      "INSERT INTO conformity_decision_invalidations (decision_id, reopened_summary_id, invalidated_by, invalidated_at) SELECT id, confirmed_summary_id, $1, now() FROM conformity_decisions LIMIT 1", [owner]);
    await invalidate();
    await assert.rejects(invalidate(), /decision_id|unique/i, "one invalidation per decision");
    for (const table of ["conformity_decisions", "conformity_decision_invalidations"]) {
      for (const statement of [`UPDATE ${table} SET seq = seq`, `DELETE FROM ${table}`, `TRUNCATE ${table}`]) {
        await assert.rejects(pool.query(statement), (error: Error) => error.message.length > 0, statement);
      }
    }
    assert.equal((await decisionRows(pool)).length, 1);
    assert.equal((await invalidationRows(pool)).length, 1);
  });
});
