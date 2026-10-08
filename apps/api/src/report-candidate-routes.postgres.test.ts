import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { acceptedEvidenceResponseSchema, confirmedSummarySchema, conformityDecisionSchema, reportCandidateListSchema, reportCandidateSchema } from "@cetem-qc/schemas/api/v1";
import type { ReportCandidate } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { migrate } from "./db/migrate.js";
import { createMemoryObjectStorage } from "./modules/files/index.js";
import type { ObjectStorage } from "./modules/files/index.js";
import { createWordTemplateGenerator, reportCommandTestSeams } from "./modules/reports/index.js";
import type { ReportDocumentGenerator } from "./modules/reports/index.js";
import { registerDefaultSummaryReopenParticipants } from "./register-participants.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";
import { readZip } from "./test-support/zip-reader.js";

// Story 11.1: Word report candidates (synthetic names, in-memory storage; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cette demande est invalide." } };
const NOT_CONFIRMED = { error: { code: "SUMMARY_NOT_CONFIRMED", message: "La synthèse n’est pas confirmée : le rapport ne peut pas être généré." } };
const NOT_DECIDED = { error: { code: "CONFORMITY_NOT_DECIDED", message: "Aucune décision de conformité n’est enregistrée : le rapport ne peut pas être généré." } };
const ATTEMPT = { error: { code: "REPORT_ATTEMPT_CONFLICT", message: "Cette demande de génération est invalide." } };
const CHANGED = { error: { code: "REPORT_INPUTS_CHANGED", message: "Les données ont changé pendant la génération : ce rapport est obsolète. Générez-le à nouveau." } };
const GENERATION_FAILED = { error: { code: "REPORT_GENERATION_FAILED", message: "Le rapport n’a pas pu être généré. Vous pouvez réessayer." } };
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

const confirm = (fixture: SyncFixture, taskId: string, text = "Synthèse finale.\nSeconde ligne.") => call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, fixture.tokens.owner, { text });
const reopen = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/summary-reopening`, fixture.tokens.owner, {});
const decide = (fixture: SyncFixture, taskId: string, outcome = "machine-conforme") => call(fixture, "POST", `/tasks/${taskId}/conformity-decision`, fixture.tokens.owner, { outcome });
const generate = (fixture: SyncFixture, taskId: string, attemptId: string | undefined = randomUUID(), token: string | null = fixture.tokens.owner, body: unknown = { attemptId }) =>
  call(fixture, "POST", `/tasks/${taskId}/report-candidates`, token, body);
const list = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner) => call(fixture, "GET", `/tasks/${taskId}/report-candidates`, token);
const download = async (fixture: SyncFixture, taskId: string, candidateId: string, token: string | null = fixture.tokens.owner) => {
  const response = await fetch(`${fixture.apiRoot}/tasks/${taskId}/report-candidates/${candidateId}/file`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
};

async function acceptedTask(fixture: SyncFixture, values: Record<string, string> = { "header.reportNumber": "R-101" }) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload(values)), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}

/** An accepted task with a confirmed summary and a recorded decision. */
async function readyTask(fixture: SyncFixture, outcome = "machine-conforme", values?: Record<string, string>) {
  const accepted = await acceptedTask(fixture, values);
  const summary = confirmedSummarySchema.parse((await confirm(fixture, accepted.taskId)).body);
  const decision = conformityDecisionSchema.parse((await decide(fixture, accepted.taskId, outcome)).body);
  return { ...accepted, summary, decision };
}

interface CandidateRow { id: string; attempt_id: string; task_id: string; audit_id: string; submission_id: string; audit_revision: number; confirmed_summary_id: string; summary_version: number; conformity_decision_id: string; origin: string; template_id: string; template_version: string; requested_by: string }
interface OutcomeRow { candidate_id: string; outcome: string; storage_ref: string | null; file_name: string | null; byte_size: number | null; sha256: string | null; failure_class: string | null }
const candidateRows = async (pool: Pool) => (await pool.query<CandidateRow>("SELECT * FROM report_candidates ORDER BY seq")).rows;
const outcomeRows = async (pool: Pool) => (await pool.query<OutcomeRow>("SELECT * FROM report_candidate_outcomes ORDER BY seq")).rows;
const reportCount = async (pool: Pool) => `${(await candidateRows(pool)).length}/${(await outcomeRows(pool)).length}`;

async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const protectedTables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes",
  "audit_lineage_links", "audit_replacement_links", "audit_deactivated_assignee_recovery_links", "audit_recovery_field_provenance",
  "audit_insight_decisions", "audit_manual_insights", "audit_review_accesses", "summary_ai_drafts", "confirmed_summaries", "summary_reopenings",
  "conformity_decisions", "conformity_decision_invalidations"];

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

/** Installs a memory storage and (optionally) a generator for one test, and always restores the production wiring. */
async function withReports<T>(run: (context: { storage: ReturnType<typeof createMemoryObjectStorage>; generator: ReportDocumentGenerator; calls: { generate: number; put: number } }) => Promise<T>,
  options: { generate?: ReportDocumentGenerator["generate"]; put?: (key: string, bytes: Uint8Array, real: ObjectStorage) => Promise<void> } = {}): Promise<T> {
  const inner = createMemoryObjectStorage();
  const calls = { generate: 0, put: 0 };
  const word = createWordTemplateGenerator();
  const storage = Object.assign(Object.create(inner) as typeof inner, {
    put: async (key: string, bytes: Uint8Array) => { calls.put++; if (options.put) await options.put(key, bytes, inner); await inner.put(key, bytes); },
  });
  const generator: ReportDocumentGenerator = {
    templateId: word.templateId, templateVersion: word.templateVersion,
    generate: async (document) => { calls.generate++; return options.generate ? options.generate(document) : word.generate(document); },
  };
  reportCommandTestSeams.storage = storage;
  reportCommandTestSeams.generator = generator;
  try { return await run({ storage: inner, generator, calls }); } finally {
    reportCommandTestSeams.storage = undefined;
    reportCommandTestSeams.generator = undefined;
    registerDefaultSummaryReopenParticipants();
  }
}

const candidateOf = (reply: Reply): ReportCandidate => reportCandidateSchema.parse(reply.body);

test("R1 R2 confirmed summary and either decision: 201 ready, bound to the current revision, summary and decision; one row, one outcome, one object", async () => {
  await withReports(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { pool, owner } = fixture;
      for (const outcome of ["machine-conforme", "machine-non-conforme"] as const) {
        const { taskId, submissionId, summary, decision } = await readyTask(fixture, outcome, { "header.reportNumber": `R-${outcome}`, "header.etablissement": "Clinique Synthétique" });
        const attemptId = randomUUID();
        const reply = await generate(fixture, taskId, attemptId);
        assert.equal(reply.status, 201, reply.text);
        assert.match(reply.cacheControl ?? "", /no-store/i);
        const candidate = candidateOf(reply);
        assert.equal(candidate.status, "ready");
        assert.deepEqual([candidate.attemptId, candidate.origin, candidate.failureClass, candidate.requestedBy], [attemptId, "generated-word", null, { id: owner, displayName: "Responsable Test" }]);
        assert.deepEqual(candidate.template, { id: "cetem-paper-report", version: "1.0.0" });
        assert.deepEqual(candidate.bindings, { auditRevision: 1, summaryId: summary.id, summaryVersion: 1, conformityDecisionId: decision.id, conformityOutcome: outcome });
        const row = (await candidateRows(pool)).find((candidateRow) => candidateRow.id === candidate.id)!;
        const audit = (await pool.query<{ audit_id: string }>("SELECT audit_id FROM audit_submissions WHERE id = $1", [submissionId])).rows[0]!;
        assert.deepEqual([row.task_id, row.audit_id, row.submission_id, row.audit_revision, row.confirmed_summary_id, row.summary_version, row.conformity_decision_id, row.requested_by],
          [taskId, audit.audit_id, submissionId, 1, summary.id, 1, decision.id, owner]);
        const stored = (await outcomeRows(pool)).find((outcomeRow) => outcomeRow.candidate_id === candidate.id)!;
        assert.equal(stored.outcome, "ready");
        assert.equal(stored.storage_ref, `reports/${candidate.id}.docx`);
        const bytes = (await storage.get(stored.storage_ref!))!;
        assert.equal(candidate.file!.byteSize, bytes.length);
        assert.equal(candidate.file!.sha256, createHash("sha256").update(bytes).digest("hex"));
        assert.deepEqual([stored.byte_size, stored.sha256, stored.file_name], [bytes.length, candidate.file!.sha256, candidate.file!.name]);
        assert.match(candidate.file!.name, /^Rapport-LCQ-candidat-\d{8}-[0-9a-f]{8}\.docx$/);
        const xml = readZip(bytes).get("word/document.xml")!.toString("utf8");
        assert.ok(xml.includes(outcome === "machine-conforme" ? "Machine conforme" : "Machine non conforme"));
        assert.ok(xml.includes("Clinique Synthétique") && xml.includes(`R-${outcome}/LCQ`) && xml.includes("Seconde ligne."));
        assert.ok(!("official" in reply.body) && !/official|officiel/i.test(reply.text));
      }
      assert.equal(await reportCount(pool), "2/2");
      assert.equal(storage.keys().length, 2);
    });
  });
});

test("R3 every per-test verdict combination generates for both decisions", async () => {
  await withReports(async () => {
    await withSyncFixture(async (fixture) => {
      const combos: Array<Record<string, string>> = [
        { "header.reportNumber": "R-V1" },
        { "header.reportNumber": "R-V2", "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2" },
        { "header.reportNumber": "R-V3", "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "20" },
        { "header.reportNumber": "R-V4", "voltage.repeatability.row1.kvMeasured": "69,7", "voltage.repeatability.row1.kerma": "2,677", "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,9" },
      ];
      let index = 0;
      for (const values of combos) {
        for (const outcome of ["machine-conforme", "machine-non-conforme"]) {
          const { taskId } = await readyTask(fixture, outcome, { ...values, "header.reportNumber": `${values["header.reportNumber"]}-${index++}` });
          const reply = await generate(fixture, taskId);
          assert.equal(reply.status, 201, JSON.stringify(values));
          assert.equal(candidateOf(reply).bindings.conformityOutcome, outcome);
        }
      }
    });
  });
});

test("R4 summary open (never confirmed, or reopened) gives 409 SUMMARY_NOT_CONFIRMED, no rows and no object", async () => {
  await withReports(async ({ storage, calls }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await acceptedTask(fixture);
      const never = await generate(fixture, taskId);
      assert.deepEqual([never.status, never.body], [409, NOT_CONFIRMED]);
      assert.equal((await confirm(fixture, taskId)).status, 201);
      assert.equal((await decide(fixture, taskId)).status, 201);
      assert.equal((await reopen(fixture, taskId)).status, 201);
      const reopened = await generate(fixture, taskId);
      assert.deepEqual([reopened.status, reopened.body], [409, NOT_CONFIRMED]);
      assert.equal(await reportCount(fixture.pool), "0/0");
      assert.deepEqual(storage.keys(), []);
      assert.equal(calls.generate, 0);
    });
  });
});

test("R5 confirmed without a current decision gives 409 CONFORMITY_NOT_DECIDED and no rows", async () => {
  await withReports(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await acceptedTask(fixture);
      assert.equal((await confirm(fixture, taskId)).status, 201);
      const undecided = await generate(fixture, taskId);
      assert.deepEqual([undecided.status, undecided.body], [409, NOT_DECIDED]);
      assert.equal((await decide(fixture, taskId)).status, 201);
      assert.equal((await reopen(fixture, taskId)).status, 201);
      assert.equal((await confirm(fixture, taskId, "Nouvelle synthèse.")).status, 201);
      const invalidated = await generate(fixture, taskId);
      assert.deepEqual([invalidated.status, invalidated.body], [409, NOT_DECIDED]);
      assert.equal(await reportCount(fixture.pool), "0/0");
      assert.deepEqual(storage.keys(), []);
    });
  });
});

test("R6 a missing or invalid attemptId and an extra property give 422 and no rows", async () => {
  await withReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      for (const body of [{}, { attemptId: "pas-un-uuid" }, { attemptId: 12 }, { attemptId: randomUUID(), extra: true }, []]) {
        const reply = await generate(fixture, taskId, undefined, fixture.tokens.owner, body);
        assert.deepEqual([reply.status, reply.body], [422, INVALID], JSON.stringify(body));
      }
      // The shared strict JSON parser rejects non-object bodies before the route runs (400, as for every other route).
      for (const body of [null, "texte"]) {
        const reply = await generate(fixture, taskId, undefined, fixture.tokens.owner, body);
        assert.equal(reply.status, 400, JSON.stringify(body));
      }
      assert.equal(await reportCount(fixture.pool), "0/0");
    });
  });
});

test("R7 Employé 403; malformed, unknown, other-team, draft and no-audit tasks 404 identical to 9.1; nothing is written", async () => {
  await withReports(async ({ calls }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const draftTask = await fixture.newTask(fixture.employee);
      const noAudit = await fixture.newTask(fixture.employee);
      assert.equal((await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-D" })), fixture.tokens.employee)).status, 200);
      for (const token of [fixture.tokens.employee, fixture.tokens.colleague]) {
        const refused = await generate(fixture, taskId, randomUUID(), token);
        assert.deepEqual([refused.status, refused.body], [403, FORBIDDEN]);
        assert.equal((await list(fixture, taskId, token)).status, 403);
      }
      assert.equal((await generate(fixture, taskId, randomUUID(), null)).status, 401);
      const targets = ["not-a-uuid", randomUUID(), draftTask, noAudit, taskId];
      for (const target of targets.slice(0, 4)) {
        const reply = await generate(fixture, target);
        assert.deepEqual([reply.status, reply.body], [404, NOT_FOUND], target);
        const invalid = await generate(fixture, target, undefined, fixture.tokens.owner, { nope: 1 });
        assert.deepEqual([invalid.status, invalid.body], [404, NOT_FOUND], `invalid body on ${target}`);
        assert.deepEqual([(await list(fixture, target)).status, (await list(fixture, target)).body], [404, NOT_FOUND]);
      }
      const other = await generate(fixture, taskId, randomUUID(), fixture.tokens.otherOwner);
      assert.deepEqual([other.status, other.body], [404, NOT_FOUND]);
      assert.deepEqual([(await list(fixture, taskId, fixture.tokens.otherOwner)).status], [404]);
      assert.equal(await reportCount(fixture.pool), "0/0");
      assert.equal(calls.generate, 0);
    });
  });
});

test("R8 a throwing generator gives 502, a failed outcome and no stored object; summary, decision, audit and task are untouched", async () => {
  await withReports(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const before = await fingerprint(pool, protectedTables);
      const attemptId = randomUUID();
      const { result: reply, lines } = await captureInfo(() => generate(fixture, taskId, attemptId));
      assert.deepEqual([reply.status, reply.body], [502, GENERATION_FAILED]);
      const candidates = await candidateRows(pool);
      const outcomes = await outcomeRows(pool);
      assert.equal(candidates.length, 1);
      assert.deepEqual([outcomes[0]!.candidate_id, outcomes[0]!.outcome, outcomes[0]!.failure_class, outcomes[0]!.storage_ref, outcomes[0]!.file_name, outcomes[0]!.byte_size, outcomes[0]!.sha256],
        [candidates[0]!.id, "failed", "generation-failed", null, null, null, null]);
      assert.deepEqual(storage.keys(), []);
      assert.equal(await fingerprint(pool, protectedTables), before);
      assert.ok(lines.some((line) => JSON.parse(line).event === "report.candidate.failed" && JSON.parse(line).class === "generation-failed"));
    });
  }, { generate: async () => { throw new Error("generator exploded with /secret/path"); } });
});

test("R9 a storage failure gives 502, outcome storage-failed, and the partially written object is removed and never referenced", async () => {
  await withReports(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const reply = await generate(fixture, taskId);
      assert.deepEqual([reply.status, reply.body], [502, GENERATION_FAILED]);
      const outcomes = await outcomeRows(fixture.pool);
      assert.deepEqual([outcomes[0]!.outcome, outcomes[0]!.failure_class, outcomes[0]!.storage_ref], ["failed", "storage-failed", null]);
      assert.deepEqual(storage.keys(), []);
      assert.equal(reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates[0]!.failureClass, "storage-failed");
    });
  }, { put: async (key, bytes, real) => { await real.put(key, bytes.subarray(0, 10)); throw new Error("disk full at C:\private"); } });
});

test("R10 after a failure a new attemptId succeeds and the list holds failed and ready, newest first", async () => {
  let failing = true;
  await withReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      assert.equal((await generate(fixture, taskId)).status, 502);
      failing = false;
      const ready = await generate(fixture, taskId);
      assert.equal(ready.status, 201);
      const shown = reportCandidateListSchema.parse((await list(fixture, taskId)).body);
      assert.deepEqual(shown.candidates.map((candidate) => candidate.status), ["ready", "failed"]);
      assert.equal(shown.candidates[0]!.id, candidateOf(ready).id);
    });
  }, { generate: async (document) => { if (failing) throw new Error("boom"); return createWordTemplateGenerator().generate(document); } });
});

test("R11 replaying a ready attemptId returns 200 with the same candidate and calls neither generator nor storage", async () => {
  await withReports(async ({ calls }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const attemptId = randomUUID();
      const first = await generate(fixture, taskId, attemptId);
      assert.equal(first.status, 201);
      const snapshot = { ...calls };
      const replay = await generate(fixture, taskId, attemptId);
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.body, first.body);
      assert.deepEqual(calls, snapshot);
      assert.equal(await reportCount(fixture.pool), "1/1");
    });
  });
});

test("R12 replaying a failed attemptId returns the same 502 and creates nothing", async () => {
  await withReports(async ({ calls }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const attemptId = randomUUID();
      assert.equal((await generate(fixture, taskId, attemptId)).status, 502);
      const snapshot = { ...calls };
      const replay = await generate(fixture, taskId, attemptId);
      assert.deepEqual([replay.status, replay.body], [502, GENERATION_FAILED]);
      assert.deepEqual(calls, snapshot);
      assert.equal(await reportCount(fixture.pool), "1/1");
    });
  }, { generate: async () => { throw new Error("boom"); } });
});

test("R13 one attemptId on another task gives 409 REPORT_ATTEMPT_CONFLICT and writes nothing", async () => {
  await withReports(async ({ calls }) => {
    await withSyncFixture(async (fixture) => {
      const first = await readyTask(fixture, "machine-conforme", { "header.reportNumber": "R-A1" });
      const second = await readyTask(fixture, "machine-non-conforme", { "header.reportNumber": "R-A2" });
      const attemptId = randomUUID();
      assert.equal((await generate(fixture, first.taskId, attemptId)).status, 201);
      const snapshot = { ...calls };
      const conflict = await generate(fixture, second.taskId, attemptId);
      assert.deepEqual([conflict.status, conflict.body], [409, ATTEMPT]);
      assert.equal(await reportCount(fixture.pool), "1/1");
      assert.deepEqual(calls, snapshot);
    });
  });
});

test("R14 two concurrent requests with one attemptId leave one candidate that both responses describe", async () => {
  await withReports(async ({ calls }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const attemptId = randomUUID();
      const [one, two] = await Promise.all([generate(fixture, taskId, attemptId), generate(fixture, taskId, attemptId)]);
      assert.equal((await candidateRows(fixture.pool)).length, 1);
      assert.ok([one.status, two.status].includes(201), `${one.status}/${two.status}`);
      assert.ok([one, two].every((reply) => reply.status === 201 || reply.status === 200));
      assert.equal(candidateOf(one).id, candidateOf(two).id);
      assert.equal(calls.generate, 1);
    });
  });
});

/** A generator that holds until released, so the test can change the inputs between the insert and the completion. */
function blockedGenerator() {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  const word = createWordTemplateGenerator();
  return { release, hasStarted, generate: async (document: Parameters<ReportDocumentGenerator["generate"]>[0]) => { started(); await gate; return word.generate(document); } };
}

test("R15 a reopening between insert and completion gives outdated and 409 REPORT_INPUTS_CHANGED, keeping the file", async () => {
  const blocked = blockedGenerator();
  await withReports(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const pending = generate(fixture, taskId);
      await blocked.hasStarted;
      assert.equal((await reopen(fixture, taskId)).status, 201);
      blocked.release();
      const reply = await pending;
      assert.deepEqual([reply.status, reply.body], [409, CHANGED]);
      const outcomes = await outcomeRows(fixture.pool);
      assert.deepEqual(outcomes.map((row) => row.outcome), ["outdated"]);
      assert.equal(storage.keys().length, 1, "the file is retained");
      assert.equal(outcomes[0]!.storage_ref, storage.keys()[0]);
      const shown = reportCandidateListSchema.parse((await list(fixture, taskId)).body);
      assert.deepEqual(shown.candidates.map((candidate) => candidate.status), ["outdated"]);
      assert.notEqual((await download(fixture, taskId, shown.candidates[0]!.id)).status, 404);
      const replay = await generate(fixture, taskId, shown.candidates[0]!.attemptId);
      assert.deepEqual([replay.status, replay.body], [409, CHANGED]);
    });
  }, { generate: blocked.generate });
});

test("R16 reopen, reconfirm and re-decide during generation: the candidate is outdated because the bound ids differ", async () => {
  const blocked = blockedGenerator();
  await withReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const pending = generate(fixture, taskId);
      await blocked.hasStarted;
      assert.equal((await reopen(fixture, taskId)).status, 201);
      assert.equal((await confirm(fixture, taskId, "Autre synthèse.")).status, 201);
      assert.equal((await decide(fixture, taskId, "machine-non-conforme")).status, 201);
      blocked.release();
      const reply = await pending;
      assert.deepEqual([reply.status, reply.body], [409, CHANGED]);
      assert.deepEqual((await outcomeRows(fixture.pool)).map((row) => row.outcome), ["outdated"]);
    });
  }, { generate: blocked.generate });
});

test("R17 a ready candidate reads outdated after a reopening without any report write; a new candidate is ready after re-deciding", async () => {
  await withReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const first = candidateOf(await generate(fixture, taskId));
      const reportTables = async () => fingerprint(pool, ["report_candidates", "report_candidate_outcomes"]);
      const before = await reportTables();
      assert.equal((await reopen(fixture, taskId)).status, 201);
      assert.equal(await reportTables(), before, "a reopening writes nothing to the report tables");
      const shown = reportCandidateListSchema.parse((await list(fixture, taskId)).body);
      assert.deepEqual(shown.candidates.map((candidate) => [candidate.id, candidate.status]), [[first.id, "outdated"]]);
      assert.equal((await download(fixture, taskId, first.id)).status, 200, "an outdated candidate stays downloadable");
      assert.equal((await confirm(fixture, taskId, "Synthèse révisée.")).status, 201);
      assert.equal((await decide(fixture, taskId)).status, 201);
      const second = candidateOf(await generate(fixture, taskId));
      assert.equal(second.status, "ready");
      const final = reportCandidateListSchema.parse((await list(fixture, taskId)).body);
      assert.deepEqual(final.candidates.map((candidate) => [candidate.id, candidate.status]), [[second.id, "ready"], [first.id, "outdated"]]);
      assert.equal(final.candidates[0]!.bindings.summaryVersion, 2);
    });
  });
});

test("R18 the list is team-scoped, newest first, derives generating from a missing outcome and exposes no storage reference", async () => {
  await withReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const first = candidateOf(await generate(fixture, taskId));
      const second = candidateOf(await generate(fixture, taskId));
      const row = (await candidateRows(pool)).find((candidate) => candidate.id === first.id)!;
      const forgedAttempt = randomUUID();
      await pool.query(
        `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version, conformity_decision_id, origin, template_id, template_version, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'generated-word', $9, $10, $11)`,
        [forgedAttempt, row.task_id, row.audit_id, row.submission_id, row.audit_revision, row.confirmed_summary_id, row.summary_version, row.conformity_decision_id, row.template_id, row.template_version, row.requested_by],
      );
      const reply = await list(fixture, taskId);
      const shown = reportCandidateListSchema.parse(reply.body);
      assert.deepEqual(shown.candidates.map((candidate) => candidate.status), ["generating", "ready", "ready"]);
      assert.deepEqual(shown.candidates.slice(1).map((candidate) => candidate.id), [second.id, first.id]);
      assert.equal(shown.candidates[0]!.attemptId, forgedAttempt);
      assert.equal(shown.candidates[0]!.file, null);
      assert.match(reply.cacheControl ?? "", /no-store/i);
      assert.ok(!/storage|reports\/|storageRef|storage_ref/.test(reply.text));
      assert.deepEqual((await list(fixture, taskId, fixture.tokens.otherOwner)).body, NOT_FOUND);
      const otherTask = await readyTask(fixture, "machine-conforme", { "header.reportNumber": "R-OTHER" });
      assert.deepEqual(reportCandidateListSchema.parse((await list(fixture, otherTask.taskId)).body).candidates, []);
    });
  });
});

test("R19 R20 download returns the exact bytes with the required headers; every other case is a refusal", async () => {
  let failing = false;
  await withReports(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const ready = candidateOf(await generate(fixture, taskId));
      const file = await download(fixture, taskId, ready.id);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get("content-type"), DOCX);
      assert.equal(file.headers.get("content-disposition"), `attachment; filename="${ready.file!.name}"`);
      assert.match(file.headers.get("cache-control") ?? "", /no-store/i);
      assert.equal(file.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual([...file.bytes], [...(await storage.get(`reports/${ready.id}.docx`))!]);
      assert.equal(createHash("sha256").update(file.bytes).digest("hex"), ready.file!.sha256);

      failing = true;
      const failed = candidateOf(await (async () => { const reply = await generate(fixture, taskId); assert.equal(reply.status, 502); return { ...reply, body: ((await list(fixture, taskId)).body.candidates as Record<string, unknown>[])[0]! }; })());
      failing = false;
      const row = (await candidateRows(pool))[0]!;
      await pool.query(
        `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version, conformity_decision_id, origin, template_id, template_version, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'generated-word', $9, $10, $11)`,
        [randomUUID(), row.task_id, row.audit_id, row.submission_id, row.audit_revision, row.confirmed_summary_id, row.summary_version, row.conformity_decision_id, row.template_id, row.template_version, row.requested_by],
      );
      const generating = (await candidateRows(pool)).at(-1)!.id;
      const otherTeam = await download(fixture, taskId, ready.id, fixture.tokens.otherOwner);
      const refused: Array<[string, Awaited<ReturnType<typeof download>>]> = [
        ["failed", await download(fixture, taskId, failed.id)],
        ["generating", await download(fixture, taskId, generating)],
        ["unknown", await download(fixture, taskId, randomUUID())],
        ["malformed", await download(fixture, taskId, "pas-un-uuid")],
        ["other team", otherTeam],
        ["other task", await download(fixture, (await readyTask(fixture, "machine-conforme", { "header.reportNumber": "R-X" })).taskId, ready.id)],
      ];
      for (const [label, reply] of refused) {
        assert.equal(reply.status, 404, label);
        assert.deepEqual(JSON.parse(reply.bytes.toString("utf8")), NOT_FOUND, label);
      }
      assert.equal((await download(fixture, taskId, ready.id, fixture.tokens.employee)).status, 403);
      assert.equal((await download(fixture, taskId, ready.id, null)).status, 401);
    });
  }, { generate: async (document) => { if (failing) throw new Error("boom"); return createWordTemplateGenerator().generate(document); } });
});

test("R21 generation writes only the two report tables and one object; no official property; no access row", async () => {
  await withReports(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const before = await fingerprint(pool, protectedTables);
      const created = await generate(fixture, taskId);
      const shown = await list(fixture, taskId);
      const candidate = candidateOf(created);
      assert.equal((await download(fixture, taskId, candidate.id)).status, 200);
      assert.equal(await fingerprint(pool, protectedTables), before, "evidence, summaries, decisions, insights, access rows and tasks.updated_at are unchanged");
      assert.equal(storage.keys().length, 1);
      for (const text of [created.text, shown.text]) assert.ok(!/"official"|"isOfficial"|"designated"/.test(text));
      const evidence = acceptedEvidenceResponseSchema.parse((await call(fixture, "GET", `/tasks/${taskId}/accepted-evidence`, fixture.tokens.owner)).body);
      assert.ok(!("reportCandidates" in evidence));
    });
  });
});

test("R22 the report tables are insert-only and check their outcome shape", async () => {
  await withReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const candidate = candidateOf(await generate(fixture, taskId));
      for (const statement of [
        "UPDATE report_candidates SET template_id = 'x'", "DELETE FROM report_candidates", "TRUNCATE report_candidates",
        "UPDATE report_candidate_outcomes SET byte_size = 1", "DELETE FROM report_candidate_outcomes", "TRUNCATE report_candidate_outcomes",
      ]) {
        await assert.rejects(pool.query(statement), (error: Error) => { assert.ok(error.message.length > 0); return true; }, statement);
      }
      await assert.rejects(pool.query("INSERT INTO report_candidate_outcomes (candidate_id, outcome, failure_class) VALUES ($1, 'failed', 'generation-failed')", [candidate.id]), /unique|duplicate/i, "one outcome per candidate");
      const row = (await candidateRows(pool))[0]!;
      const fresh = async () => (await pool.query<{ id: string }>(
        `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version, conformity_decision_id, origin, template_id, template_version, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'generated-word', $9, $10, $11) RETURNING id`,
        [randomUUID(), row.task_id, row.audit_id, row.submission_id, row.audit_revision, row.confirmed_summary_id, row.summary_version, row.conformity_decision_id, row.template_id, row.template_version, row.requested_by],
      )).rows[0]!.id;
      await assert.rejects(pool.query("INSERT INTO report_candidate_outcomes (candidate_id, outcome) VALUES ($1, 'ready')", [await fresh()]), /check/i);
      await assert.rejects(pool.query("INSERT INTO report_candidate_outcomes (candidate_id, outcome, storage_ref, file_name, byte_size, sha256, failure_class) VALUES ($1, 'failed', 'reports/x.docx', 'x.docx', 1, 'a', 'storage-failed')", [await fresh()]), /check/i);
      await assert.rejects(pool.query("INSERT INTO report_candidate_outcomes (candidate_id, outcome, failure_class) VALUES ($1, 'failed', 'other')", [await fresh()]), /check/i);
      await assert.rejects(pool.query("INSERT INTO report_candidate_outcomes (candidate_id, outcome) VALUES ($1, 'official')", [await fresh()]), /check/i);
      await assert.rejects(pool.query(
        `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version, conformity_decision_id, origin, template_id, template_version, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploaded-pdf', $9, $10, $11)`,
        [randomUUID(), row.task_id, row.audit_id, row.submission_id, row.audit_revision, row.confirmed_summary_id, row.summary_version, row.conformity_decision_id, row.template_id, row.template_version, row.requested_by],
      ), /check/i);
    });
  });
});

test("R23 logs carry only the event, the actor and a fixed class; never IDs, names, paths or text", async () => {
  let failing = false;
  await withReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { owner } = fixture;
      const { taskId } = await readyTask(fixture, "machine-conforme", { "header.etablissement": "Clinique Secrète" });
      const unconfirmed = await acceptedTask(fixture);
      let logged!: { id: string; name: string; attempt: string };
      const { lines } = await captureInfo(async () => {
        const created = await generate(fixture, taskId);
        const candidate = candidateOf(created);
        await generate(fixture, taskId, candidate.attemptId);
        await list(fixture, taskId);
        await download(fixture, taskId, candidate.id);
        await download(fixture, taskId, randomUUID());
        failing = true;
        await generate(fixture, taskId);
        failing = false;
        await generate(fixture, unconfirmed.taskId);
        await generate(fixture, randomUUID());
        await generate(fixture, taskId, randomUUID(), fixture.tokens.employee);
        logged = { id: candidate.id, name: candidate.file!.name, attempt: candidate.attemptId };
      });
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => String(line.event).startsWith("report.candidate."));
      assert.deepEqual([...new Set(parsed.map((line) => line.event))].sort(), ["report.candidate.downloaded", "report.candidate.failed", "report.candidate.generated", "report.candidate.refused"]);
      for (const line of parsed) {
        assert.ok(Object.keys(line).every((key) => ["event", "actorId", "class"].includes(key)), JSON.stringify(line));
        assert.equal(typeof line.actorId, "string");
      }
      const classes = parsed.filter((line) => line.event === "report.candidate.refused").map((line) => line.class);
      assert.ok(classes.includes("not-found") && classes.includes("not-confirmed") && classes.includes("forbidden-role"));
      const everything = lines.join("\n");
      for (const secret of [taskId, unconfirmed.taskId, logged.id, logged.name, logged.attempt, "Clinique Secrète", "Synthèse finale", "reports/", "boom"]) assert.ok(!everything.includes(secret), secret);
      assert.ok(parsed.every((line) => line.actorId === owner || line.actorId === fixture.employee));
    });
  }, { generate: async (document) => { if (failing) throw new Error("boom"); return createWordTemplateGenerator().generate(document); } });
});

test("R25 migration 0022 applies on top of 0021 data without rewriting any row", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    const { taskId } = await readyTask(fixture);
    assert.ok(taskId);
    const before = await fingerprint(pool, protectedTables);
    const tables = (await pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'report_candidate%'")).rows;
    assert.equal(tables.length, 0, "0022 is not applied yet");
    await migrate(pool);
    assert.deepEqual((await pool.query<{ version: string }>("SELECT version FROM schema_migrations WHERE version LIKE '0022%'")).rows.length, 1);
    assert.equal(await fingerprint(pool, protectedTables), before);
    assert.equal(await reportCount(pool), "0/0");
  }, { migrateThrough: "0021_conformity_decisions" });
});
