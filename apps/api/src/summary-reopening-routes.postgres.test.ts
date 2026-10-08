import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { acceptedEvidenceResponseSchema, confirmedSummarySchema, summaryReopeningSchema } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { summaryCommandTestSeams } from "./modules/summaries/commands/request-summary-draft.js";
import { getConfirmedSummary, getSummaryHistory, getSummaryState, isSummaryConfirmed } from "./modules/summaries/queries/confirmed-summary.js";
import { registerSummaryReopenParticipant, summaryReopenParticipantTestSeams } from "./modules/summaries/reopen-participants.js";
import type { SummaryReopenParticipant } from "./modules/summaries/reopen-participants.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 10.3: reopening a confirmed summary before official designation (synthetic names, mock provider; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cette demande est invalide." } };
const FAILED = { error: { code: "INTERNAL_ERROR", message: "La synthèse n’a pas pu être rouverte." } };
const NOT_CONFIRMED = { error: { code: "SUMMARY_NOT_CONFIRMED", message: "La synthèse n’est pas confirmée : elle ne peut pas être rouverte." } };
const DESIGNATED = { error: { code: "SUMMARY_DESIGNATED", message: "Un rapport officiel est désigné : la synthèse ne peut plus être rouverte." } };
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

const confirm = (fixture: SyncFixture, taskId: string, text = "Synthèse finale.") => call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, fixture.tokens.owner, { text });
const reopen = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner, body: unknown = {}) => call(fixture, "POST", `/tasks/${taskId}/summary-reopening`, token, body);
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

const confirmedRowText = async (pool: Pool) => (await pool.query<{ t: string }>("SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY seq), '[]'::jsonb)::text AS t FROM confirmed_summaries c")).rows[0]!.t;
const reopeningRows = async (pool: Pool) => (await pool.query<{ confirmed_summary_id: string; reopened_by: string; task_id: string; submission_id: string; reopened_at: Date }>("SELECT * FROM summary_reopenings ORDER BY seq")).rows;
const versionsOf = async (pool: Pool) => (await pool.query<{ version: number }>("SELECT version FROM confirmed_summaries ORDER BY seq")).rows.map((row) => row.version);

async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const protectedTables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes",
  "audit_lineage_links", "audit_replacement_links", "audit_deactivated_assignee_recovery_links", "audit_recovery_field_provenance",
  "audit_insight_decisions", "audit_manual_insights", "audit_review_accesses", "summary_ai_drafts", "confirmed_summaries"];

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

/** Runs with synthetic participants and always clears the production registry afterwards. */
async function withParticipants<T>(participants: SummaryReopenParticipant[], run: () => Promise<T>): Promise<T> {
  for (const participant of participants) registerSummaryReopenParticipant(participant);
  try { return await run(); } finally { summaryReopenParticipantTestSeams.clear(); }
}

test("R53 confirm then reopen returns 201 with version 2 and the previous summary; one reopening row; the confirmed row is byte-identical", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const confirmedReply = await confirm(fixture, taskId);
    assert.equal(confirmedReply.status, 201);
    const summary = confirmedSummarySchema.parse(confirmedReply.body);
    assert.equal(summary.version, 1);
    const rowsBefore = await confirmedRowText(pool);
    const before = Date.now();
    const reply = await reopen(fixture, taskId);
    assert.equal(reply.status, 201);
    assert.match(reply.cacheControl ?? "", /no-store/i);
    const body = summaryReopeningSchema.parse(reply.body);
    assert.equal(body.version, 2);
    assert.deepEqual(body.previous, summary);
    assert.deepEqual(body.reopenedBy, { id: owner, displayName: "Responsable Test" });
    const rows = await reopeningRows(pool);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0]!.confirmed_summary_id, rows[0]!.reopened_by, rows[0]!.task_id, rows[0]!.submission_id], [summary.id, owner, taskId, submissionId]);
    assert.equal(rows[0]!.reopened_at.toISOString(), body.reopenedAt);
    assert.ok(Math.abs(rows[0]!.reopened_at.getTime() - before) < 60_000, "the date is the server date");
    assert.equal(await confirmedRowText(pool), rowsBefore, "the reopened confirmed row is untouched");
  });
});

test("R54 after reopening there is no current summary; the evidence shows the open version and the old text as history", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const draft = (await requestDraft(fixture, taskId)).body as { id: string };
    const summary = confirmedSummarySchema.parse((await call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, fixture.tokens.owner, { text: "Texte un.", draftId: draft.id })).body);
    assert.equal(await isSummaryConfirmed(pool, submissionId), true);
    assert.equal((await reopen(fixture, taskId)).status, 201);
    assert.equal(await getConfirmedSummary(pool, submissionId), null);
    assert.equal(await isSummaryConfirmed(pool, submissionId), false);
    assert.deepEqual(await getSummaryState(pool, submissionId), { state: "open", nextVersion: 2 });
    const body = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.equal(body.summary, null);
    assert.deepEqual(body.summaryVersion, { number: 2, state: "open" });
    assert.equal(body.summaryHistory.length, 1);
    const item = body.summaryHistory[0]!;
    assert.deepEqual([item.version, item.text, item.confirmedBy, item.confirmedAt, item.initialDraft], [1, "Texte un.", summary.confirmedBy, summary.confirmedAt, summary.initialDraft]);
    assert.equal(item.reopenedBy.displayName, "Responsable Test");
    assert.deepEqual((await getSummaryHistory(pool, submissionId)).map((entry) => entry.version), [1]);
  });
});

test("R55 while open insights, decisions and drafts work again; re-confirmation stores version 2 with a rebuilt input set and locks again", async () => {
  await withSyncFixture(async (fixture) => {
    await withSyntheticRegistry(["regle-a"], async () => {
      const { pool } = fixture;
      const { taskId, submissionId } = await acceptedTask(fixture);
      const first = confirmedSummarySchema.parse((await confirm(fixture, taskId, "Texte un.")).body);
      assert.equal((await addManual(fixture, taskId, "Bloqué.")).status, 409);
      assert.equal((await reopen(fixture, taskId)).status, 201);
      assert.equal((await addManual(fixture, taskId, "Câble usé.")).status, 201);
      assert.equal((await decide(fixture, taskId, proposalIdOf("regle-a", submissionId), "retained")).status, 200);
      assert.equal((await requestDraft(fixture, taskId)).status, 201);
      const firstRowText = JSON.stringify((await pool.query("SELECT * FROM confirmed_summaries WHERE id = $1", [first.id])).rows[0]);
      const second = confirmedSummarySchema.parse((await confirm(fixture, taskId, "Texte deux.")).body);
      assert.equal(second.version, 2);
      assert.notEqual(second.id, first.id);
      assert.notEqual(second.summaryInputSetId, first.summaryInputSetId, "the input set is rebuilt at the new confirmation");
      assert.deepEqual(await versionsOf(pool), [1, 2]);
      assert.equal(JSON.stringify((await pool.query("SELECT * FROM confirmed_summaries WHERE id = $1", [first.id])).rows[0]), firstRowText, "the old row stays");
      assert.deepEqual((await addManual(fixture, taskId, "Encore.")).body, LOCKED);
      assert.deepEqual((await decide(fixture, taskId, proposalIdOf("regle-a", submissionId), "discarded")).body, LOCKED);
      assert.deepEqual((await requestDraft(fixture, taskId)).body, LOCKED);
      assert.deepEqual(acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body).summaryVersion, { number: 2, state: "confirmed" });
    });
  });
});

test("R56 reopening an unconfirmed or already reopened summary gives 409; confirming twice stays 409; two cycles give versions 1, 2, 3", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    assert.deepEqual([(await reopen(fixture, taskId)).status, (await reopen(fixture, taskId)).body], [409, NOT_CONFIRMED]);
    assert.equal((await reopenings(pool)), 0);
    assert.equal((await confirm(fixture, taskId, "Un.")).status, 201);
    assert.deepEqual((await confirm(fixture, taskId, "Un bis.")).body, ALREADY);
    assert.equal((await reopen(fixture, taskId)).status, 201);
    assert.deepEqual((await reopen(fixture, taskId)).body, NOT_CONFIRMED);
    assert.equal((await reopenings(pool)), 1);
    assert.equal(summaryVersionOf(await confirm(fixture, taskId, "Deux.")), 2);
    assert.equal((await reopen(fixture, taskId)).status, 201);
    assert.equal(summaryVersionOf(await confirm(fixture, taskId, "Trois.")), 3);
    assert.deepEqual(await versionsOf(pool), [1, 2, 3]);
    const body = acceptedEvidenceResponseSchema.parse((await evidence(fixture, taskId)).body);
    assert.deepEqual(body.summaryHistory.map((item) => [item.version, item.text]), [[2, "Deux."], [1, "Un."]], "newest first");
    assert.deepEqual(body.summary?.version, 3);
  });
});
const reopenings = async (pool: Pool) => (await reopeningRows(pool)).length;
const summaryVersionOf = (reply: Reply) => (reply.body as { version: number }).version;

test("R57 two concurrent reopens leave one row; a concurrent confirm and reopen end consistent", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    const replies = await Promise.all([reopen(fixture, taskId), reopen(fixture, taskId)]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [201, 409]);
    assert.equal(await reopenings(pool), 1);

    const racing = await acceptedTask(fixture, { "header.reportNumber": "R-096" });
    assert.equal((await confirm(fixture, racing.taskId)).status, 201);
    const mixed = await Promise.all([reopen(fixture, racing.taskId), confirm(fixture, racing.taskId, "Concurrent.")]);
    assert.ok(mixed.every((reply) => [201, 409].includes(reply.status)));
    const current = (await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM confirmed_summaries c WHERE c.submission_id = $1 AND NOT EXISTS (SELECT 1 FROM summary_reopenings r WHERE r.confirmed_summary_id = c.id)", [racing.submissionId])).rows[0]!.n;
    assert.ok(Number(current) <= 1, "never two current summaries");
    assert.ok(["confirmed", "open"].includes((await getSummaryState(pool, racing.submissionId)).state));
    assert.equal((await getSummaryState(pool, submissionId)).state, "open");
  });
});

const participant = (name: string, overrides: Partial<SummaryReopenParticipant> = {}, calls: string[] = []): SummaryReopenParticipant => ({
  name,
  hasOfficialDesignation: async () => { calls.push(`${name}:designation`); return false; },
  onSummaryReopened: async () => { calls.push(`${name}:reopened`); },
  ...overrides,
});

test("R58 a participant reporting a designation refuses with 409 and nothing is notified; otherwise each is notified once inside the transaction", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const summary = confirmedSummarySchema.parse((await confirm(fixture, taskId)).body);
    const calls: string[] = [];
    await withParticipants([participant("conformite", {}, calls), participant("rapports", { hasOfficialDesignation: async () => { calls.push("rapports:designation"); return true; } }, calls)], async () => {
      const refused = await reopen(fixture, taskId);
      assert.deepEqual([refused.status, refused.body], [409, DESIGNATED]);
    });
    assert.deepEqual(calls, ["conformite:designation", "rapports:designation"], "no onSummaryReopened call");
    assert.equal(await reopenings(pool), 0);
    assert.equal((await getSummaryState(pool, submissionId)).state, "confirmed");

    const contexts: Array<Record<string, unknown>> = [];
    const readsRow: boolean[] = [];
    const observing = (name: string) => participant(name, {
      onSummaryReopened: async (transaction, context) => {
        contexts.push({ name, ...context });
        readsRow.push((await transaction.query("SELECT 1 FROM summary_reopenings WHERE confirmed_summary_id = $1", [context.reopenedSummaryId])).rows.length === 1);
      },
    });
    await withParticipants([observing("conformite"), observing("rapports")], async () => {
      const reply = await reopen(fixture, taskId);
      assert.equal(reply.status, 201);
      const body = summaryReopeningSchema.parse(reply.body);
      assert.deepEqual(contexts.map((context) => context.name), ["conformite", "rapports"]);
      for (const context of contexts) {
        assert.deepEqual([context.taskId, context.submissionId, context.reopenedSummaryId, context.actorId, context.reopenedAt], [taskId, submissionId, summary.id, fixture.owner, body.reopenedAt]);
      }
      assert.deepEqual(readsRow, [true, true], "the participant sees the new row in the same transaction");
    });
  });
});

test("R58 registering a participant twice with one name throws", () => {
  try {
    registerSummaryReopenParticipant(participant("doublon"));
    assert.throws(() => registerSummaryReopenParticipant(participant("doublon")), /already registered/);
  } finally { summaryReopenParticipantTestSeams.clear(); }
});

test("R59 a throwing participant rolls the whole reopening back with a 500", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    await pool.query("CREATE TABLE synthetic_participant_marks (note text NOT NULL)");
    const marking = participant("marqueur", { onSummaryReopened: async (transaction) => { await transaction.query("INSERT INTO synthetic_participant_marks (note) VALUES ('marque')"); } });
    const failing = participant("defaillant", { onSummaryReopened: async () => { throw new Error("forced"); } });
    await withParticipants([marking, failing], async () => {
      const reply = await reopen(fixture, taskId);
      assert.deepEqual([reply.status, reply.body], [500, FAILED]);
    });
    assert.equal(await reopenings(pool), 0);
    assert.equal((await pool.query("SELECT 1 FROM synthetic_participant_marks")).rows.length, 0, "the earlier participant's write is rolled back too");
    assert.equal((await getSummaryState(pool, submissionId)).state, "confirmed");
    assert.equal((await reopen(fixture, taskId)).status, 201, "a later reopening works without the failing participant");
  });
});

test("R60 records bound to a summary id are current only while it equals the current confirmed id; summaries reads no conformity or report table", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const first = confirmedSummarySchema.parse((await confirm(fixture, taskId)).body);
    const isCurrent = async (boundSummaryId: string) => (await getConfirmedSummary(pool, submissionId))?.id === boundSummaryId;
    assert.equal(await isCurrent(first.id), true);
    assert.equal((await reopen(fixture, taskId)).status, 201);
    assert.equal(await isCurrent(first.id), false, "bound to the old text: non-current while open");
    const second = confirmedSummarySchema.parse((await confirm(fixture, taskId, "Nouvelle version.")).body);
    assert.equal(await isCurrent(first.id), false, "still non-current after re-confirmation");
    assert.equal(await isCurrent(second.id), true);
  });
  const root = join(process.cwd(), "src", "modules", "summaries");
  const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
  for (const file of sources(root)) assert.ok(!/\b(conformity|report)_\w+/i.test(readFileSync(file, "utf8")), `${file} must not reference conformity or report tables`);
});

test("R61 refusals write nothing and use the documented status and body", async () => {
  await withSyncFixture(async (fixture) => {
    const { tokens, pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    const draftTask = await fixture.newTask(fixture.employee);
    await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-BROUILLON" })));
    const noAudit = await fixture.newTask(fixture.employee);
    const refusals = [
      await reopen(fixture, taskId, tokens.employee),
      await reopen(fixture, "not-a-uuid"), await reopen(fixture, "00000000-0000-4000-8000-0000000000aa"),
      await reopen(fixture, taskId, tokens.otherOwner), await reopen(fixture, draftTask), await reopen(fixture, noAudit),
    ];
    assert.deepEqual(refusals.map((reply) => reply.status), [403, 404, 404, 404, 404, 404]);
    assert.deepEqual(refusals.map((reply) => reply.body), [FORBIDDEN, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND]);
    assert.equal(refusals[1]!.text, (await evidence(fixture, "not-a-uuid")).text, "byte-identical to 9.1's 404");
    assert.equal((await reopen(fixture, taskId, null)).status, 401);
    const extra = await reopen(fixture, taskId, tokens.owner, { reason: "x" });
    assert.deepEqual([extra.status, extra.body], [422, INVALID]);
    assert.deepEqual((await reopen(fixture, "00000000-0000-4000-8000-0000000000aa", tokens.owner, { reason: "x" })).body, NOT_FOUND, "an invalid body never reveals whether a task exists");
    assert.equal(await reopenings(pool), 0);
    const second = await acceptedTask(fixture, { "header.reportNumber": "R-098" });
    assert.equal((await confirm(fixture, second.taskId)).status, 201);
    reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, identity: { ...snapshot.identity, ruleVersion: "1.0.0" } });
    try {
      const inconsistent = await reopen(fixture, second.taskId);
      assert.deepEqual([inconsistent.status, inconsistent.body], [500, FAILED]);
    } finally { reviewCommandTestSeams.snapshot = undefined; }
    assert.equal(await reopenings(pool), 0);
  });
});

test("R62 reopening writes only the reopening row and calls no provider", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await addManual(fixture, taskId, "Constat.")).status, 201);
    assert.equal((await requestDraft(fixture, taskId)).status, 201);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    assert.equal((await evidence(fixture, taskId)).status, 200);
    const before = await fingerprint(fixture.pool, protectedTables);
    let providerCalls = 0;
    summaryCommandTestSeams.provider = { name: "fake", model: "fake-model", generate: async () => { providerCalls++; return "x"; } };
    try {
      assert.equal((await reopen(fixture, taskId)).status, 201);
    } finally { summaryCommandTestSeams.provider = undefined; }
    assert.equal(providerCalls, 0);
    assert.equal(await fingerprint(fixture.pool, protectedTables), before);
    assert.equal(await reopenings(fixture.pool), 1);
  });
});

test("R63 log lines carry the event, the actor ID and a fixed class only", async () => {
  await withSyncFixture(async (fixture) => {
    const { owner, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture, { "header.reportNumber": "R-SECRET-VALUE" });
    const { lines } = await captureInfo(async () => {
      await confirm(fixture, taskId, "TEXTE-SECRET");
      await reopen(fixture, taskId, tokens.employee);
      await reopen(fixture, taskId, tokens.otherOwner);
      await reopen(fixture, taskId);
      await reopen(fixture, taskId);
      await confirm(fixture, taskId, "TEXTE-SECRET-DEUX");
      await withParticipants([participant("rapports", { hasOfficialDesignation: async () => true })], () => reopen(fixture, taskId));
    });
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => ["summary.reopened", "summary.reopen_refused"].includes(String(line.event)));
    assert.deepEqual(events.map((line) => [line.event, line.class ?? null]), [
      ["summary.reopen_refused", "forbidden-role"], ["summary.reopen_refused", "not-found"], ["summary.reopened", null],
      ["summary.reopen_refused", "not-confirmed"], ["summary.reopen_refused", "designated"],
    ]);
    assert.deepEqual(Object.keys(events[2]!).sort(), ["actorId", "event"]);
    assert.equal(events[2]!.actorId, owner);
    for (const line of lines) for (const secret of [taskId, "SECRET", "Rapport"]) assert.ok(!line.includes(secret), `${secret} in ${line}`);
  });
});

test("K26 migration 0020: existing rows get version 1, one row per submission and version, one reopening per summary, insert-only", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await confirm(fixture, taskId)).status, 201);
    assert.deepEqual(await versionsOf(pool), [1]);
    const insertReopening = () => pool.query("INSERT INTO summary_reopenings (confirmed_summary_id, reopened_by, task_id, submission_id) SELECT id, $1, task_id, submission_id FROM confirmed_summaries LIMIT 1", [fixture.owner]);
    await insertReopening();
    await assert.rejects(insertReopening(), /summary_reopenings/, "one reopening per confirmed summary");
    for (const statement of ["UPDATE summary_reopenings SET reopened_by = reopened_by", "DELETE FROM summary_reopenings", "TRUNCATE summary_reopenings"]) {
      await assert.rejects(pool.query(statement), (error: Error) => error.message.length > 0, statement);
    }
    assert.equal(await reopenings(pool), 1);
    await assert.rejects(pool.query("UPDATE confirmed_summaries SET version = 9"), (error: Error) => error.message.length > 0, "the confirmed rows stay insert-only");
  });
});
