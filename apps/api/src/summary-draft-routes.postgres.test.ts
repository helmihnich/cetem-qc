import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalJson } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";
import { summaryDraftResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { SummaryProviderError } from "./modules/ai/index.js";
import type { SummaryDraftProvider } from "./modules/ai/index.js";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { summaryCommandTestSeams } from "./modules/summaries/commands/request-summary-draft.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 10.1: AI summary draft requests (synthetic names, the mock provider or an injected fake; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cette demande de brouillon est invalide." } };
const FAILED = { error: { code: "INTERNAL_ERROR", message: "Le brouillon n’a pas pu être enregistré." } };
const UNAVAILABLE = { error: { code: "AI_UNAVAILABLE", message: "Le brouillon IA n’est pas disponible. Réessayez ou rédigez la synthèse manuellement." } };

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

const requestDraft = (fixture: SyncFixture, taskId: string, body: unknown = {}, token: string | null = fixture.tokens.owner) => call(fixture, "POST", `/tasks/${taskId}/summary-drafts`, token, body);
const evidence = (fixture: SyncFixture, taskId: string) => call(fixture, "GET", `/tasks/${taskId}/accepted-evidence`, fixture.tokens.owner);
const decide = (fixture: SyncFixture, taskId: string, proposalId: string, decision: "retained" | "discarded") => call(fixture, "POST", `/tasks/${taskId}/insight-decisions`, fixture.tokens.owner, { proposalId, decision });
const addManual = (fixture: SyncFixture, taskId: string, text: string, justification?: string) => call(fixture, "POST", `/tasks/${taskId}/manual-insights`, fixture.tokens.owner, justification ? { text, justification } : { text });

async function acceptedTask(fixture: SyncFixture, values: Record<string, string> = { "header.reportNumber": "R-091" }) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload(values)), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}

type DraftRow = {
  seq: string; id: string; requested_by: string; task_id: string; audit_id: string; submission_id: string; revision: number; revision_identity: Record<string, unknown>;
  summary_input_set_id: string; input_set: { insights: Array<Record<string, unknown>> } & Record<string, unknown>; provider: string; model: string;
  status: string; failure_class: string | null; draft_text: string | null; requested_at: Date;
};
const draftRows = async (pool: Pool) => (await pool.query<DraftRow>("SELECT * FROM summary_ai_drafts ORDER BY seq")).rows;

async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const protectedTables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes",
  "audit_lineage_links", "audit_replacement_links", "audit_deactivated_assignee_recovery_links", "audit_recovery_field_provenance",
  "audit_insight_decisions", "audit_manual_insights", "audit_review_accesses"];

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

const fakeProvider = (generate: SummaryDraftProvider["generate"], name = "fake", model = "fake-model"): SummaryDraftProvider => ({ name, model, generate });
const withProvider = async <T,>(provider: SummaryDraftProvider | undefined, run: () => Promise<T>): Promise<T> => {
  summaryCommandTestSeams.provider = provider;
  try { return await run(); } finally { summaryCommandTestSeams.provider = undefined; summaryCommandTestSeams.beforeProviderCall = undefined; summaryCommandTestSeams.timeoutMs = undefined; }
};

test("R32 a request returns 201 and inserts exactly one generated row with every attribution and linkage field", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner } = fixture;
    const { taskId, submissionId } = await acceptedTask(fixture);
    const before = Date.now();
    const reply = await requestDraft(fixture, taskId);
    assert.equal(reply.status, 201);
    assert.match(reply.cacheControl ?? "", /no-store/i);
    const body = summaryDraftResponseSchema.parse(reply.body);
    const rows = await draftRows(pool);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    const audit = (await pool.query<{ id: string }>("SELECT id FROM audits WHERE task_id = $1", [taskId])).rows[0]!;
    assert.deepEqual([row.id, row.requested_by, row.task_id, row.audit_id, row.submission_id, row.revision, row.provider, row.model, row.status, row.failure_class, row.draft_text],
      [body.id, owner, taskId, audit.id, submissionId, 1, "mock", "mock-fixed-text", "generated", null, fr.summary.mockDraft]);
    assert.deepEqual(row.revision_identity, { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" });
    assert.ok(Math.abs(row.requested_at.getTime() - before) < 60_000, "the date is the server date");
    assert.equal(row.summary_input_set_id, createHash("sha256").update(canonicalJson(row.input_set)).digest("hex"), "the identity is the hash of the stored input set");
    assert.deepEqual(
      { id: body.id, status: body.status, text: body.text, provider: body.provider, model: body.model, requestedAt: body.requestedAt, requestedBy: body.requestedBy, summaryInputSetId: body.summaryInputSetId },
      { id: row.id, status: "generated", text: row.draft_text, provider: "mock", model: "mock-fixed-text", requestedAt: row.requested_at.toISOString(), requestedBy: { id: owner, displayName: "Responsable Test" }, summaryInputSetId: row.summary_input_set_id },
    );
    assert.ok(!/conforme|confirm/i.test(JSON.stringify(Object.keys(body))), "no confirmation or conformity field");
    assert.equal(row.input_set.version, 1);
    assert.ok(!JSON.stringify(row.input_set).includes(taskId) && !JSON.stringify(row.input_set).includes("Établissement A") && !JSON.stringify(row.input_set).includes("Employé Test"));
  });
});

test("R33 the stored input set holds exactly the retained insights at request time", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId, submissionId } = await acceptedTask(fixture);
    // Zero retained insights with the production registry.
    assert.equal((await requestDraft(fixture, taskId)).status, 201);
    assert.deepEqual((await draftRows(fixture.pool))[0]!.input_set.insights, []);

    await withSyntheticRegistry(["regle-retenue", "regle-ecartee", "regle-non-decidee"], async () => {
      assert.equal((await decide(fixture, taskId, proposalIdOf("regle-retenue", submissionId), "retained")).status, 200);
      assert.equal((await decide(fixture, taskId, proposalIdOf("regle-ecartee", submissionId), "discarded")).status, 200);
      assert.equal((await addManual(fixture, taskId, "Câble usé.", "Constat visuel.")).status, 201);
      assert.equal((await requestDraft(fixture, taskId)).status, 201);
      const second = (await draftRows(fixture.pool))[1]!;
      assert.deepEqual(second.input_set.insights, [
        { sourceType: "rule", statement: "Rapport R-091 (regle-retenue)." },
        { sourceType: "manual", text: "Câble usé.", justification: "Constat visuel." },
      ]);
      const serialized = JSON.stringify(second.input_set);
      assert.ok(!serialized.includes("regle-ecartee") && !serialized.includes("regle-non-decidee"));

      assert.equal((await addManual(fixture, taskId, "Ajout tardif.")).status, 201);
      assert.equal((await requestDraft(fixture, taskId)).status, 201);
      const third = (await draftRows(fixture.pool))[2]!;
      assert.equal(third.input_set.insights.length, 3, "the later insight appears only in the next request");
      assert.equal(second.input_set.insights.length, 2);
    });
  });
});

test("R34 two requests keep two rows, the same data gives the same identity and changed insights a different one", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await requestDraft(fixture, taskId)).status, 201);
    assert.equal((await requestDraft(fixture, taskId)).status, 201);
    let rows = await draftRows(fixture.pool);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]!.id, rows[1]!.id);
    assert.equal(rows[0]!.summary_input_set_id, rows[1]!.summary_input_set_id);
    assert.equal((await addManual(fixture, taskId, "Nouvel insight.")).status, 201);
    assert.equal((await requestDraft(fixture, taskId)).status, 201);
    rows = await draftRows(fixture.pool);
    assert.equal(rows.length, 3);
    assert.notEqual(rows[2]!.summary_input_set_id, rows[0]!.summary_input_set_id);
  });
});

test("R35 a provider failure inserts a failed row with the class only, returns 502 and a retry succeeds", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    const secret = "PROVIDER-SECRET-TEXT";
    const failing = fakeProvider(async () => { throw new SummaryProviderError("provider-error"); }, "fake", "fake-model");
    const failed = await withProvider(failing, () => requestDraft(fixture, taskId));
    assert.deepEqual([failed.status, failed.body], [502, UNAVAILABLE]);
    assert.ok(!failed.text.includes(secret));
    let rows = await draftRows(fixture.pool);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0]!.status, rows[0]!.failure_class, rows[0]!.draft_text, rows[0]!.provider, rows[0]!.model], ["failed", "provider-error", null, "fake", "fake-model"]);
    assert.ok(/^[0-9a-f]{64}$/.test(rows[0]!.summary_input_set_id) && rows[0]!.input_set.version === 1, "a failed row still keeps the input set");

    // Other failure shapes map to fixed classes; a thrown error's text is never kept.
    const shapes: Array<[SummaryDraftProvider["generate"], string]> = [
      [async () => { throw new Error(secret); }, "provider-error"],
      [async () => "   ", "empty-output"],
      [async () => { throw new SummaryProviderError("not-configured"); }, "not-configured"],
      [async () => { throw new SummaryProviderError("timeout"); }, "timeout"],
    ];
    for (const [generate, expected] of shapes) {
      const reply = await withProvider(fakeProvider(generate), () => requestDraft(fixture, taskId));
      assert.equal(reply.status, 502);
      assert.equal((await draftRows(fixture.pool)).at(-1)!.failure_class, expected);
    }
    // A provider that ignores the signal is cut off at the time bound.
    const hanging = fakeProvider(() => new Promise<string>(() => undefined));
    const timedOut = await withProvider(hanging, async () => { summaryCommandTestSeams.timeoutMs = 50; return requestDraft(fixture, taskId); });
    assert.equal(timedOut.status, 502);
    assert.equal((await draftRows(fixture.pool)).at(-1)!.failure_class, "timeout");

    const retry = await requestDraft(fixture, taskId);
    assert.equal(retry.status, 201);
    rows = await draftRows(fixture.pool);
    assert.equal(rows.length, 7);
    assert.equal(rows.at(-1)!.status, "generated");
    assert.ok(rows.every((row) => !JSON.stringify(row).includes(secret)));
  });
});

test("R36 refusals write no row, never call the provider and use the documented status and body", async () => {
  await withSyncFixture(async (fixture) => {
    const { tokens } = fixture;
    const { taskId } = await acceptedTask(fixture);
    const draftTask = await fixture.newTask(fixture.employee);
    await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-BROUILLON" })));
    const noAudit = await fixture.newTask(fixture.employee);
    let providerCalls = 0;
    const spy = fakeProvider(async () => { providerCalls++; return "texte"; });
    await withProvider(spy, async () => {
      const refusals = [
        await requestDraft(fixture, taskId, {}, tokens.employee),
        await requestDraft(fixture, "not-a-uuid"), await requestDraft(fixture, "00000000-0000-4000-8000-0000000000aa"),
        await requestDraft(fixture, taskId, {}, tokens.otherOwner), await requestDraft(fixture, draftTask), await requestDraft(fixture, noAudit),
      ];
      assert.deepEqual(refusals.map((reply) => reply.status), [403, 404, 404, 404, 404, 404]);
      assert.deepEqual(refusals.map((reply) => reply.body), [FORBIDDEN, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND]);
      assert.equal(refusals[1]!.text, (await evidence(fixture, "not-a-uuid")).text, "byte-identical to 9.1's 404");
      const unauthenticated = await requestDraft(fixture, taskId, {}, null);
      assert.equal(unauthenticated.status, 401);
      for (const body of [{ text: "x" }, { input: {} }, { insights: [] }, []]) {
        const reply = await requestDraft(fixture, taskId, body);
        assert.deepEqual([reply.status, reply.body], [422, INVALID], JSON.stringify(body));
      }
      // A JSON primitive is refused by the application-wide strict JSON parser before the route (the existing 400 envelope).
      for (const body of [null, "texte"]) {
        const reply = await requestDraft(fixture, taskId, body);
        assert.deepEqual([reply.status, reply.body], [400, { error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." } }], JSON.stringify(body));
      }
      const noBody = await fetch(`${fixture.apiRoot}/tasks/${taskId}/summary-drafts`, { method: "POST", headers: { authorization: `Bearer ${tokens.owner}` } });
      assert.equal(noBody.status, 422);
      assert.deepEqual((await requestDraft(fixture, "00000000-0000-4000-8000-0000000000aa", { text: "x" })).body, NOT_FOUND, "an invalid body never reveals whether a task exists");
      reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, identity: { ...snapshot.identity, ruleVersion: "1.0.0" } });
      try {
        const inconsistent = await requestDraft(fixture, taskId);
        assert.deepEqual([inconsistent.status, inconsistent.body], [500, FAILED]);
      } finally { reviewCommandTestSeams.snapshot = undefined; }
    });
    assert.equal(providerCalls, 0);
    assert.equal((await draftRows(fixture.pool)).length, 0);
  });
});

test("R37 UPDATE, DELETE and TRUNCATE on summary_ai_drafts are refused", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await requestDraft(fixture, taskId)).status, 201);
    for (const statement of ["UPDATE summary_ai_drafts SET draft_text = 'x'", "DELETE FROM summary_ai_drafts", "TRUNCATE summary_ai_drafts"]) {
      await assert.rejects(fixture.pool.query(statement), (error: Error) => error.message.length > 0, statement);
    }
    assert.equal((await draftRows(fixture.pool)).length, 1);
  });
});

test("K18 the migration status and failure-class checks match the adapter failure classes", async () => {
  await withSyncFixture(async (fixture) => {
    const checks = (await fixture.pool.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'summary_ai_drafts'::regclass AND contype = 'c'",
    )).rows.map((row) => row.definition).join("\n");
    for (const failureClass of ["not-configured", "timeout", "provider-error", "empty-output"]) assert.ok(checks.includes(`'${failureClass}'`), failureClass);
    assert.ok(checks.includes("'generated'") && checks.includes("'failed'"));
    assert.ok(!checks.includes("confirmed"));
  });
});

test("R38 requests leave the evidence, decision, manual-insight and access tables and tasks.updated_at byte-identical", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture);
    assert.equal((await addManual(fixture, taskId, "Constat.")).status, 201);
    assert.equal((await evidence(fixture, taskId)).status, 200);
    const before = await fingerprint(fixture.pool, protectedTables);
    for (let attempt = 0; attempt < 3; attempt++) assert.equal((await requestDraft(fixture, taskId)).status, 201);
    await withProvider(fakeProvider(async () => { throw new SummaryProviderError("provider-error"); }), async () => { assert.equal((await requestDraft(fixture, taskId)).status, 502); });
    assert.equal(await fingerprint(fixture.pool, protectedTables), before);
    assert.equal((await draftRows(fixture.pool)).length, 4);
  });
});

test("R39 the provider is called outside any transaction and receives a prompt built only from the stored input set", async () => {
  await withSyncFixture(async (fixture) => {
    const { taskId } = await acceptedTask(fixture, { "header.reportNumber": "R-091", "header.etablissement": "Clinique Synthétique" });
    let prompt = "";
    let busyConnections = -1;
    const spy = fakeProvider(async (received) => {
      prompt = received;
      // The command holds no pooled connection (so no transaction) while the provider runs: only this probe is busy.
      await fixture.pool.query("SELECT 1").then(() => undefined);
      busyConnections = fixture.pool.totalCount - fixture.pool.idleCount;
      return "Texte du brouillon.";
    });
    const reply = await withProvider(spy, () => requestDraft(fixture, taskId));
    assert.equal(reply.status, 201);
    assert.equal(busyConnections, 0, "no connection is held by the command during the provider call");
    const row = (await draftRows(fixture.pool))[0]!;
    assert.ok(prompt.endsWith(canonicalJson(row.input_set)), "the prompt carries the stored input set");
    for (const forbidden of [taskId, row.id, "Établissement A", "Radiologie", "Employé Test", "Responsable Test", fixture.owner, fixture.employee, row.submission_id, row.audit_id]) {
      assert.ok(!prompt.includes(forbidden), forbidden);
    }
    assert.ok(prompt.includes("R-091"), "stored measurement and comment values are sent as stored");
  });
});

test("R40 captured log lines carry the actor ID, provider, status, class and duration only", async () => {
  await withSyncFixture(async (fixture) => {
    const { owner, tokens } = fixture;
    const { taskId } = await acceptedTask(fixture, { "header.reportNumber": "R-SECRET-VALUE" });
    assert.equal((await addManual(fixture, taskId, "TEXTE-SECRET")).status, 201);
    const provider = fakeProvider(async () => "BROUILLON-SECRET");
    const failing = fakeProvider(async () => { throw new Error("ERREUR-SECRETE"); }, "fake", "fake-model");
    const { lines } = await captureInfo(async () => {
      await requestDraft(fixture, taskId, {}, tokens.employee);
      await requestDraft(fixture, taskId, {}, tokens.otherOwner);
      await requestDraft(fixture, taskId, { text: "x" });
      await withProvider(provider, () => requestDraft(fixture, taskId));
      await withProvider(failing, () => requestDraft(fixture, taskId));
    });
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(parsed.map((line) => line.event), ["summary.ai_draft_refused", "summary.ai_draft_refused", "summary.ai_draft_refused", "summary.ai_draft_generated", "summary.ai_draft_failed"]);
    assert.deepEqual(parsed.slice(0, 3).map((line) => line.class), ["forbidden-role", "not-found", "validation"]);
    assert.deepEqual(Object.keys(parsed[3]!).sort(), ["actorId", "durationMs", "event", "provider"]);
    assert.deepEqual(Object.keys(parsed[4]!).sort(), ["actorId", "class", "durationMs", "event", "provider"]);
    assert.equal(parsed[3]!.actorId, owner);
    assert.equal(parsed[4]!.class, "provider-error");
    for (const line of lines) for (const secret of [taskId, "SECRET", "Rapport", "Constat"]) assert.ok(!line.includes(secret), `${secret} in ${line}`);
  });
});
