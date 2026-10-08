import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalJson } from "@cetem-qc/domain";
import { acceptedEvidenceResponseSchema, confirmedSummarySchema } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { SummaryProviderError } from "./modules/ai/index.js";
import type { SummaryDraftProvider } from "./modules/ai/index.js";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { confirmSummaryTestSeams } from "./modules/summaries/commands/confirm-summary.js";
import { summaryCommandTestSeams } from "./modules/summaries/commands/request-summary-draft.js";
import { getConfirmedSummary, isSummaryConfirmed } from "./modules/summaries/queries/confirmed-summary.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 10.2: explicit confirmation of the final summary (synthetic names, the mock provider or an injected fake; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cette synthèse est invalide." } };
const FAILED = { error: { code: "INTERNAL_ERROR", message: "La synthèse n’a pas pu être confirmée." } };
const ALREADY = { error: { code: "SUMMARY_ALREADY_CONFIRMED", message: "La synthèse est déjà confirmée." } };
const LOCKED = { error: { code: "SUMMARY_CONFIRMED", message: "La synthèse est confirmée : cette action n’est plus possible." } };

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

const confirm = (fixture: SyncFixture, taskId: string, body: unknown, token: string | null = fixture.tokens.owner) => call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, token, body);
const requestDraft = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/summary-drafts`, fixture.tokens.owner, {});
const evidence = (fixture: SyncFixture, taskId: string) => call(fixture, "GET", `/tasks/${taskId}/accepted-evidence`, fixture.tokens.owner);
const decide = (fixture: SyncFixture, taskId: string, proposalId: string, decision: "retained" | "discarded") => call(fixture, "POST", `/tasks/${taskId}/insight-decisions`, fixture.tokens.owner, { proposalId, decision });
const addManual = (fixture: SyncFixture, taskId: string, text: string) => call(fixture, "POST", `/tasks/${taskId}/manual-insights`, fixture.tokens.owner, { text });

async function acceptedTask(fixture: SyncFixture, values: Record<string, string> = { "header.reportNumber": "R-091" }) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload(values)), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}

type SummaryRow = {
  seq: string; id: string; confirmed_by: string; task_id: string; audit_id: string; submission_id: string; revision: number; revision_identity: Record<string, unknown>;
  initial_draft_id: string | null; final_text: string; summary_input_set_id: string; input_set: { insights: Array<Record<string, unknown>> } & Record<string, unknown>; confirmed_at: Date;
};
const summaryRows = async (pool: Pool) => (await pool.query<SummaryRow>("SELECT * FROM confirmed_summaries ORDER BY seq")).rows;
const draftRowsText = async (pool: Pool) => (await pool.query<{ t: string }>("SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY seq), '[]'::jsonb)::text AS t FROM summary_ai_drafts d")).rows[0]!.t;

async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const protectedTables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes",
  "audit_lineage_links", "audit_replacement_links", "audit_deactivated_assignee_recovery_links", "audit_recovery_field_provenance",
  "audit_insight_decisions", "audit_manual_insights", "audit_review_accesses", "summary_ai_drafts"];

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

const syntheticRule = (ruleId: string) => ({
  ruleId, ruleVersion: 1, approvalReference: "Document de test synthétique", sources: [{ kind: "field" as const, key: "header.reportNumber" }],
  evaluate: (input: { values: Readonly<Record<string, string>> }) => [{ sourceKeys: [{ kind: "field" as const, key: "header.reportNumber" }], params: { numero: input.values["header.reportNumber"] ?? "" } }],
});
const withSyntheticRegistry = async <T,>(ruleIds: string[], run: () => Promise<T>): Promise<T> => {
  reviewCommandTestSeams.insightRegistry = { rules: ruleIds.map(syntheticRule), templates: Object.fromEntries(ruleIds.map((ruleId) => [ruleId, `Rapport {numero} (${ruleId}).`])) };
  try { return await run(); } finally { reviewCommandTestSeams.insightRegistry = undefined; }
};
const proposalIdOf = (ruleId: string, submissionId: string) => `${ruleId}:v1:${submissionId}:field=header.reportNumber`;

const fakeProvider = (generate: SummaryDraftProvider["generate"]): SummaryDraftProvider => ({ name: "fake", model: "fake-model", generate });
const withProvider = async <T,>(provider: SummaryDraftProvider | undefined, run: () => Promise<T>): Promise<T> => {
  summaryCommandTestSeams.provider = provider;
  try { return await run(); } finally { summaryCommandTestSeams.provider = undefined; }
};

test("R41 a manual-only confirmation returns 201 and inserts one row with every attribution and linkage field and no draft", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const before = Date.now();
    const reply = await confirm(fixture, taskId, { text: "  Synthèse rédigée à la main.  " });
    assert.equal(reply.status, 201);
    assert.match(reply.cacheControl ?? "", /no-store/i);
    const body = confirmedSummarySchema.parse(reply.body);
    const rows = await summaryRows(pool);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    const audit = (await pool.query<{ id: string }>("SELECT id FROM audits WHERE task_id = $1", [taskId])).rows[0]!;
    assert.deepEqual([row.id, row.confirmed_by, row.task_id, row.audit_id, row.submission_id, row.revision, row.initial_draft_id, row.final_text],
      [body.id, owner, taskId, audit.id, submissionId, 1, null, "Synthèse rédigée à la main."]);
    assert.deepEqual(row.revision_identity, { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" });
    assert.ok(Math.abs(row.confirmed_at.getTime() - before) < 60_000, "the date is the server date");
    assert.equal(row.summary_input_set_id, createHash("sha256").update(canonicalJson(row.input_set)).digest("hex"));
    assert.deepEqual(body, { id: row.id, text: row.final_text, confirmedAt: row.confirmed_at.toISOString(), confirmedBy: { id: owner, displayName: "Responsable Test" }, summaryInputSetId: row.summary_input_set_id, initialDraft: null });
    assert.equal((await pool.query("SELECT 1 FROM summary_ai_drafts")).rows.length, 0, "no AI metadata is created");
  });
});

test("R42 an AI-based confirmation links the untouched draft and returns both texts and both identities", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const draft = (await requestDraft(fixture, taskId)).body as { id: string; text: string; summaryInputSetId: string };
    const draftsBefore = await draftRowsText(pool);
    const edited = await confirm(fixture, taskId, { text: "Texte corrigé par le Responsable.", draftId: draft.id });
    assert.equal(edited.status, 201);
    const body = confirmedSummarySchema.parse(edited.body);
    assert.equal(await draftRowsText(pool), draftsBefore, "the draft row is byte-identical");
    assert.equal((await summaryRows(pool))[0]!.initial_draft_id, draft.id);
    assert.equal(body.text, "Texte corrigé par le Responsable.");
    assert.deepEqual(body.initialDraft, { id: draft.id, text: draft.text, provider: "mock", model: "mock-fixed-text", requestedAt: body.initialDraft!.requestedAt, summaryInputSetId: draft.summaryInputSetId });
    assert.notEqual(body.text, body.initialDraft!.text);

    // A text equal to the draft works too.
    const second = await acceptedTask(fixture, { "header.reportNumber": "R-092" });
    const draft2 = (await requestDraft(fixture, second.taskId)).body as { id: string; text: string };
    const same = await confirm(fixture, second.taskId, { text: draft2.text, draftId: draft2.id });
    assert.equal(same.status, 201);
    assert.equal(confirmedSummarySchema.parse(same.body).text, draft2.text);
  });
});

test("R43 the confirmed input set is the actual one at confirmation; zero retained insights confirms", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    const draft = (await requestDraft(fixture, taskId)).body as { id: string; summaryInputSetId: string };
    assert.equal((await addManual(fixture, taskId, "Câble usé.")).status, 201);
    const reply = await confirm(fixture, taskId, { text: "Final.", draftId: draft.id });
    assert.equal(reply.status, 201);
    const body = confirmedSummarySchema.parse(reply.body);
    assert.equal(body.initialDraft!.summaryInputSetId, draft.summaryInputSetId);
    assert.notEqual(body.summaryInputSetId, draft.summaryInputSetId);
    const row = (await summaryRows(fixture.pool))[0]!;
    assert.deepEqual(row.input_set.insights, [{ sourceType: "manual", text: "Câble usé.", justification: null }]);
    assert.equal(row.summary_input_set_id, body.summaryInputSetId);

    const other = await acceptedTask(fixture, { "header.reportNumber": "R-093" });
    assert.equal((await confirm(fixture, other.taskId, { text: "Sans insight." })).status, 201);
    assert.deepEqual((await summaryRows(fixture.pool))[1]!.input_set.insights, []);

    await withSyntheticRegistry(["regle-retenue", "regle-ecartee"], async () => {
      const third = await acceptedTask(fixture, { "header.reportNumber": "R-094" });
      assert.equal((await decide(fixture, third.taskId, proposalIdOf("regle-retenue", third.submissionId), "retained")).status, 200);
      assert.equal((await decide(fixture, third.taskId, proposalIdOf("regle-ecartee", third.submissionId), "discarded")).status, 200);
      assert.equal((await confirm(fixture, third.taskId, { text: "Avec règle." })).status, 201);
      assert.deepEqual((await summaryRows(fixture.pool))[2]!.input_set.insights, [{ sourceType: "rule", statement: "Rapport R-094 (regle-retenue)." }]);
    });
  });
});

test("R44 an unusable draftId gives 422 and no row", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    const other = await acceptedTask(fixture, { "header.reportNumber": "R-095" });
    const otherDraft = (await requestDraft(fixture, other.taskId)).body as { id: string };
    await withProvider(fakeProvider(async () => { throw new SummaryProviderError("provider-error"); }), async () => { assert.equal((await requestDraft(fixture, taskId)).status, 502); });
    const failedId = (await fixture.pool.query<{ id: string }>("SELECT id FROM summary_ai_drafts WHERE status = 'failed'")).rows[0]!.id;
    for (const draftId of ["00000000-0000-4000-8000-0000000000aa", failedId, otherDraft.id, "not-a-uuid"]) {
      const reply = await confirm(fixture, taskId, { text: "Final.", draftId });
      assert.deepEqual([reply.status, reply.body], [422, INVALID], draftId);
    }
    assert.equal((await summaryRows(fixture.pool)).length, 0);
  });
});

test("R45 a second confirmation gives 409 and keeps one unchanged row; concurrent confirmations leave exactly one row", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId, { text: "Premier texte." })).status, 201);
    const again = await confirm(fixture, taskId, { text: "Second texte." });
    assert.deepEqual([again.status, again.body], [409, ALREADY]);
    const rows = await summaryRows(fixture.pool);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.final_text, "Premier texte.");

    const racing = await acceptedTask(fixture, { "header.reportNumber": "R-096" });
    const replies = await Promise.all([confirm(fixture, racing.taskId, { text: "A." }), confirm(fixture, racing.taskId, { text: "B." })]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [201, 409]);
    assert.equal((await fixture.pool.query("SELECT 1 FROM confirmed_summaries WHERE task_id = $1", [racing.taskId])).rows.length, 1);
  });
});

test("R46 after confirmation manual insights, decisions and draft requests give 409 and write nothing; before it they work", async () => {
  await withSyncFixture(async (fixture) => {
    await withSyntheticRegistry(["regle-a"], async () => {
      const { pool } = fixture;
      const { taskId, submissionId } = await acceptedTask(fixture);
      let providerCalls = 0;
      const spy = fakeProvider(async () => { providerCalls++; return "Texte."; });
      await withProvider(spy, async () => {
        assert.equal((await addManual(fixture, taskId, "Avant.")).status, 201);
        assert.equal((await requestDraft(fixture, taskId)).status, 201);
        assert.equal(providerCalls, 1);
        assert.equal((await confirm(fixture, taskId, { text: "Final." })).status, 201);

        const counts = async () => JSON.stringify([
          (await pool.query("SELECT 1 FROM audit_manual_insights")).rows.length, (await pool.query("SELECT 1 FROM audit_insight_decisions")).rows.length, (await pool.query("SELECT 1 FROM summary_ai_drafts")).rows.length,
        ]);
        const before = await counts();
        const replies = [
          await addManual(fixture, taskId, "Après."), await decide(fixture, taskId, proposalIdOf("regle-a", submissionId), "retained"), await requestDraft(fixture, taskId),
          await call(fixture, "POST", `/tasks/${taskId}/manual-insights`, fixture.tokens.owner, { text: "" }),
        ];
        assert.deepEqual(replies.slice(0, 3).map((reply) => [reply.status, reply.body]), [[409, LOCKED], [409, LOCKED], [409, LOCKED]]);
        assert.equal(replies[3]!.status, 422, "an invalid body is still validation, not a lock answer");
        assert.equal(await counts(), before);
        assert.equal(providerCalls, 1, "no provider call after confirmation");
      });
      // Another, unconfirmed task is unaffected.
      const other = await acceptedTask(fixture, { "header.reportNumber": "R-097" });
      assert.equal((await addManual(fixture, other.taskId, "Libre.")).status, 201);
      assert.equal((await decide(fixture, other.taskId, proposalIdOf("regle-a", other.submissionId), "retained")).status, 200);
    });
  });
});

test("R46 a confirmation that lands during the provider call refuses the draft row", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    const provider = fakeProvider(async () => { summaryCommandTestSeams.beforeProviderCall = undefined; return "Texte tardif."; });
    summaryCommandTestSeams.beforeProviderCall = async () => { assert.equal((await confirm(fixture, taskId, { text: "Final." })).status, 201); };
    try {
      const reply = await withProvider(provider, () => requestDraft(fixture, taskId));
      assert.deepEqual([reply.status, reply.body], [409, LOCKED]);
    } finally { summaryCommandTestSeams.beforeProviderCall = undefined; }
    assert.equal((await fixture.pool.query("SELECT 1 FROM summary_ai_drafts")).rows.length, 0);
  });
});

test("R47 refusals write nothing and use the documented status and body", async () => {
  await withSyncFixture(async (fixture) => {
    const { tokens } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const draftTask = await fixture.newTask(fixture.employee);
    await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-BROUILLON" })));
    const noAudit = await fixture.newTask(fixture.employee);
    const text = { text: "Final." };
    const refusals = [
      await confirm(fixture, taskId, text, tokens.employee),
      await confirm(fixture, "not-a-uuid", text), await confirm(fixture, "00000000-0000-4000-8000-0000000000aa", text),
      await confirm(fixture, taskId, text, tokens.otherOwner), await confirm(fixture, draftTask, text), await confirm(fixture, noAudit, text),
    ];
    assert.deepEqual(refusals.map((reply) => reply.status), [403, 404, 404, 404, 404, 404]);
    assert.deepEqual(refusals.map((reply) => reply.body), [FORBIDDEN, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND]);
    assert.equal(refusals[1]!.text, (await evidence(fixture, "not-a-uuid")).text, "byte-identical to 9.1's 404");
    assert.equal((await confirm(fixture, taskId, text, null)).status, 401);
    const invalid: unknown[] = [{}, { text: "" }, { text: "   \n " }, { text: "a".repeat(5001) }, { text: "a\u0000b" }, { text: "ok", extra: 1 }, { text: "ok", draftId: 5 }, { text: 5 }, []];
    for (const body of invalid) {
      const reply = await confirm(fixture, taskId, body);
      assert.deepEqual([reply.status, reply.body], [422, INVALID], JSON.stringify(body));
    }
    assert.deepEqual((await confirm(fixture, "00000000-0000-4000-8000-0000000000aa", { text: "" })).body, NOT_FOUND, "an invalid body never reveals whether a task exists");
    assert.equal((await confirm(fixture, taskId, { text: "a".repeat(5000) })).status, 201, "5000 characters are accepted");
    const second = await acceptedTask(fixture, { "header.reportNumber": "R-098" });
    reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, identity: { ...snapshot.identity, ruleVersion: "1.0.0" } });
    try {
      const inconsistent = await confirm(fixture, second.taskId, text);
      assert.deepEqual([inconsistent.status, inconsistent.body], [500, FAILED]);
    } finally { reviewCommandTestSeams.snapshot = undefined; }
    assert.equal((await summaryRows(fixture.pool)).length, 1, "only the valid 5000-character confirmation was written");
  });
});

test("R48 UPDATE, DELETE and TRUNCATE on confirmed_summaries are refused", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId, { text: "Final." })).status, 201);
    for (const statement of ["UPDATE confirmed_summaries SET final_text = 'x'", "DELETE FROM confirmed_summaries", "TRUNCATE confirmed_summaries"]) {
      await assert.rejects(fixture.pool.query(statement), (error: Error) => error.message.length > 0, statement);
    }
    assert.deepEqual((await summaryRows(fixture.pool)).map((row) => row.final_text), ["Final."]);
  });
});

test("K22 the migration checks match the schema bounds and one summary per submission", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId, submissionId } = await acceptedTask(fixture);
    const audit = (await fixture.pool.query<{ id: string }>("SELECT id FROM audits WHERE task_id = $1", [taskId])).rows[0]!.id;
    const insert = (text: string, identity = "a".repeat(64)) => fixture.pool.query(
      "INSERT INTO confirmed_summaries (confirmed_by, task_id, audit_id, submission_id, revision, revision_identity, final_text, summary_input_set_id, input_set) VALUES ($1, $2, $3, $4, 1, '{}', $5, $6, '{}')",
      [fixture.owner, taskId, audit, submissionId, text, identity],
    );
    for (const bad of ["", "a".repeat(5001)]) await assert.rejects(insert(bad), /confirmed_summaries/, String(bad.length));
    await assert.rejects(insert("ok", "xyz"));
    await insert("ok");
    await assert.rejects(insert("again"), /confirmed_summaries_submission_idx/);
  });
});

test("R49 confirmation leaves evidence, drafts, decisions, manual insights, access rows and tasks.updated_at byte-identical and calls no provider", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await addManual(fixture, taskId, "Constat.")).status, 201);
    const draft = (await requestDraft(fixture, taskId)).body as { id: string };
    assert.equal((await evidence(fixture, taskId)).status, 200);
    const before = await fingerprint(fixture.pool, protectedTables);
    let providerCalls = 0;
    await withProvider(fakeProvider(async () => { providerCalls++; return "x"; }), async () => {
      assert.equal((await confirm(fixture, taskId, { text: "Final.", draftId: draft.id })).status, 201);
    });
    assert.equal(providerCalls, 0);
    assert.equal(await fingerprint(fixture.pool, protectedTables), before);
  });
});

test("R50 the evidence response carries summary null before and the confirmed summary after, and opening still writes only the access row", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    const first = await evidence(fixture, taskId);
    assert.equal(acceptedEvidenceResponseSchema.parse(first.body).summary, null);
    const confirmedReply = await confirm(fixture, taskId, { text: "Final." });
    const before = await fingerprint(fixture.pool, protectedTables.filter((table) => table !== "audit_review_accesses"));
    const accessesBefore = (await fixture.pool.query("SELECT 1 FROM audit_review_accesses")).rows.length;
    const second = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.deepEqual(second.summary, confirmedReply.body);
    assert.equal((await fixture.pool.query("SELECT 1 FROM audit_review_accesses")).rows.length, accessesBefore + 1);
    assert.equal(await fingerprint(fixture.pool, protectedTables.filter((table) => table !== "audit_review_accesses")), before);
    assert.equal((await fixture.pool.query("SELECT 1 FROM confirmed_summaries")).rows.length, 1);
  });
});

test("R51 getConfirmedSummary and isSummaryConfirmed agree; a failed insert leaves no row and is not a 201", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    assert.equal(await getConfirmedSummary(pool, submissionId), null);
    assert.equal(await isSummaryConfirmed(pool, submissionId), false);
    confirmSummaryTestSeams.beforeInsert = () => { throw new Error("forced"); };
    try {
      const failed = await confirm(fixture, taskId, { text: "Final." });
      assert.deepEqual([failed.status, failed.body], [500, FAILED]);
    } finally { confirmSummaryTestSeams.beforeInsert = undefined; }
    assert.equal(await getConfirmedSummary(pool, submissionId), null, "a failure never claims confirmation");
    assert.equal((await evidence(fixture, taskId)).body.summary, null);
    const reply = await confirm(fixture, taskId, { text: "Final." });
    assert.equal(reply.status, 201);
    assert.deepEqual(await getConfirmedSummary(pool, submissionId), reply.body);
    assert.equal(await isSummaryConfirmed(pool, submissionId), true);
    // Saving or requesting never confirms another submission.
    const other = await acceptedTask(fixture, { "header.reportNumber": "R-099" });
    assert.equal((await requestDraft(fixture, other.taskId)).status, 201);
    assert.equal(await getConfirmedSummary(pool, other.submissionId), null);
  });
});

test("R52 log lines for confirmation and locked refusals carry the event, the actor ID and a fixed class only", async () => {
  await withSyncFixture(async (fixture) => {
    const { owner, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture, { "header.reportNumber": "R-SECRET-VALUE" });
    const { lines } = await captureInfo(async () => {
      await confirm(fixture, taskId, { text: "TEXTE-SECRET" }, tokens.employee);
      await confirm(fixture, taskId, { text: "TEXTE-SECRET" }, tokens.otherOwner);
      await confirm(fixture, taskId, { text: "" });
      await confirm(fixture, taskId, { text: "TEXTE-SECRET" });
      await confirm(fixture, taskId, { text: "TEXTE-SECRET" });
      await addManual(fixture, taskId, "INSIGHT-SECRET");
      await requestDraft(fixture, taskId);
    });
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const events = parsed.filter((line) => String(line.event).startsWith("summary.") || line.event === "audit.manual_insight_refused");
    assert.deepEqual(events.map((line) => [line.event, line.class ?? null]), [
      ["summary.confirm_refused", "forbidden-role"], ["summary.confirm_refused", "not-found"], ["summary.confirm_refused", "validation"],
      ["summary.confirmed", null], ["summary.confirm_refused", "already-confirmed"],
      ["audit.manual_insight_refused", "locked"], ["summary.ai_draft_refused", "locked"],
    ]);
    assert.ok(events.every((line) => line.actorId === owner || line.class === "forbidden-role" || line.class === "not-found"));
    assert.deepEqual(Object.keys(events[3]!).sort(), ["actorId", "event"]);
    for (const line of lines) for (const secret of [taskId, "SECRET", "Rapport"]) assert.ok(!line.includes(secret), `${secret} in ${line}`);
  });
});
