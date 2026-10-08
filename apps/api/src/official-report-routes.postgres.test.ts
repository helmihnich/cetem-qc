import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { confirmedSummarySchema, conformityDecisionSchema, officialReportSchema, reportCandidateListSchema, reportCandidateSchema, storedFileSchema } from "@cetem-qc/schemas/api/v1";
import type { OfficialReport, ReportCandidate, StoredFile } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { migrate } from "./db/migrate.js";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { createMemoryObjectStorage, createPdfScanner, fileCommandTestSeams } from "./modules/files/index.js";
import { createWordTemplateGenerator, reportCommandTestSeams, reportsReopenParticipant } from "./modules/reports/index.js";
import type { ReportDocumentGenerator } from "./modules/reports/index.js";
import { summaryReopenParticipantTestSeams } from "./modules/summaries/index.js";
import { registerDefaultSummaryReopenParticipants } from "./register-participants.js";
import { buildPdf } from "./test-support/pdf-fixtures.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 11.4: designating exactly one current report official (synthetic names, in-memory storage, scanner none; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cette demande est invalide." } };
const NOT_READY = { error: { code: "REPORT_CANDIDATE_NOT_READY", message: "Ce rapport n’est pas prêt : il doit être généré avant d’être désigné." } };
const OUTDATED = { error: { code: "REPORT_CANDIDATE_OUTDATED", message: "Les données ont changé : ce rapport est obsolète et ne peut pas être désigné." } };
const ALREADY_OFFICIAL = { error: { code: "REPORT_ALREADY_OFFICIAL", message: "Un rapport officiel est déjà désigné pour ce contrôle." } };
const OFFICIAL_DESIGNATED = { error: { code: "REPORT_OFFICIAL_DESIGNATED", message: "Un rapport officiel est désigné : aucun nouveau candidat ne peut être créé." } };
const SUMMARY_DESIGNATED = { error: { code: "SUMMARY_DESIGNATED", message: "Un rapport officiel est désigné : la synthèse ne peut plus être rouverte." } };

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
async function upload(fixture: SyncFixture, taskId: string): Promise<Reply> {
  const response = await fetch(`${fixture.apiRoot}/tasks/${taskId}/pdf-files`, {
    method: "POST",
    headers: { "content-type": "application/pdf", "x-attempt-id": randomUUID(), "x-file-name": "Rapport signé.pdf", authorization: `Bearer ${fixture.tokens.owner}` },
    body: new Uint8Array(buildPdf()),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: response.headers.get("cache-control") };
}
const confirm = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, fixture.tokens.owner, { text: "Synthèse finale." });
const reopen = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/summary-reopening`, fixture.tokens.owner, {});
const decide = (fixture: SyncFixture, taskId: string, outcome = "machine-conforme") => call(fixture, "POST", `/tasks/${taskId}/conformity-decision`, fixture.tokens.owner, { outcome });
const generate = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner) =>
  call(fixture, "POST", `/tasks/${taskId}/report-candidates`, token, { attemptId: randomUUID() });
const attach = (fixture: SyncFixture, taskId: string, fileId: string) =>
  call(fixture, "POST", `/tasks/${taskId}/pdf-files/${fileId}/report-candidate`, fixture.tokens.owner, { attemptId: randomUUID() });
const list = (fixture: SyncFixture, taskId: string) => call(fixture, "GET", `/tasks/${taskId}/report-candidates`, fixture.tokens.owner);
const designate = (fixture: SyncFixture, taskId: string, candidateId: string, token: string | null = fixture.tokens.owner, body: unknown = {}) =>
  call(fixture, "POST", `/tasks/${taskId}/report-candidates/${candidateId}/designate`, token, body);
const official = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner) => call(fixture, "GET", `/tasks/${taskId}/official-report`, token);
const statuses = async (fixture: SyncFixture, taskId: string) => new Map(reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates.map((candidate) => [candidate.id, candidate.status]));
const candidateOf = (reply: Reply): ReportCandidate => reportCandidateSchema.parse(reply.body);
const officialOf = (reply: Reply): OfficialReport => officialReportSchema.parse(reply.body);

async function acceptedTask(fixture: SyncFixture) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload({ "header.reportNumber": "R-401" })), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}
async function readyTask(fixture: SyncFixture, outcome = "machine-conforme") {
  const accepted = await acceptedTask(fixture);
  const summary = confirmedSummarySchema.parse((await confirm(fixture, accepted.taskId)).body);
  const decision = conformityDecisionSchema.parse((await decide(fixture, accepted.taskId, outcome)).body);
  return { ...accepted, summary, decision };
}
async function readyWord(fixture: SyncFixture, outcome = "machine-conforme") {
  const task = await readyTask(fixture, outcome);
  const reply = await generate(fixture, task.taskId);
  assert.equal(reply.status, 201, reply.text);
  return { ...task, candidate: candidateOf(reply) };
}

const count = async (pool: Pool, table: string) => Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n);
async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const untouchedTables = ["tasks", "task_assignments", "audits", "audit_revisions", "audit_submissions", "audit_insight_decisions", "audit_manual_insights",
  "audit_review_accesses", "summary_ai_drafts", "confirmed_summaries", "summary_reopenings", "conformity_decisions", "conformity_decision_invalidations",
  "stored_files", "stored_file_checks", "report_candidates", "report_candidate_outcomes"];

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

function blockedGenerator() {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hasStarted = new Promise<void>((resolve) => { started = resolve; });
  const word = createWordTemplateGenerator();
  return { release, hasStarted, generate: async (document: Parameters<ReportDocumentGenerator["generate"]>[0]) => { started(); await gate; return word.generate(document); } };
}

/** Installs memory storage, scanner none and an optional generator for one test, and always restores the production wiring. */
async function withOfficial<T>(run: (context: { storage: ReturnType<typeof createMemoryObjectStorage>; calls: { get: number; put: number } }) => Promise<T>,
  options: { generate?: ReportDocumentGenerator["generate"] } = {}): Promise<T> {
  const inner = createMemoryObjectStorage();
  const calls = { get: 0, put: 0 };
  const storage = Object.assign(Object.create(inner) as typeof inner, {
    get: async (key: string) => { calls.get++; return inner.get(key); },
    put: async (key: string, bytes: Uint8Array) => { calls.put++; await inner.put(key, bytes); },
  });
  const word = createWordTemplateGenerator();
  fileCommandTestSeams.storage = storage;
  fileCommandTestSeams.scanner = createPdfScanner({});
  reportCommandTestSeams.storage = storage;
  reportCommandTestSeams.generator = { templateId: word.templateId, templateVersion: word.templateVersion, generate: options.generate ?? word.generate };
  try { return await run({ storage: inner, calls }); } finally {
    fileCommandTestSeams.storage = undefined;
    fileCommandTestSeams.scanner = undefined;
    reportCommandTestSeams.storage = undefined;
    reportCommandTestSeams.generator = undefined;
    reviewCommandTestSeams.snapshot = undefined;
    summaryReopenParticipantTestSeams.clear();
    registerDefaultSummaryReopenParticipants();
  }
}

test("D1 a ready Word candidate is designated: 201 with the candidate's bindings and file, exactly one row and nothing else written", async () => {
  await withOfficial(async ({ calls }) => {
    await withSyncFixture(async (fixture) => {
      const { pool, owner } = fixture;
      const { taskId, submissionId, summary, decision, candidate } = await readyWord(fixture);
      const audit = (await pool.query<{ audit_id: string }>("SELECT audit_id FROM audit_submissions WHERE id = $1", [submissionId])).rows[0]!.audit_id;
      const before = await fingerprint(pool, untouchedTables);
      const accesses = await count(pool, "audit_review_accesses");
      const io = { ...calls };
      const reply = await designate(fixture, taskId, candidate.id);
      assert.equal(reply.status, 201, reply.text);
      assert.match(reply.cacheControl ?? "", /no-store/i);
      const result = officialOf(reply);
      assert.deepEqual([result.candidateId, result.origin, result.taskId, result.auditId, result.auditRevision, result.submissionId], [candidate.id, "generated-word", taskId, audit, 1, submissionId]);
      assert.deepEqual(result.designatedBy, { id: owner, displayName: "Responsable Test" });
      assert.ok(Math.abs(Date.now() - new Date(result.designatedAt).getTime()) < 60_000);
      assert.deepEqual(result.bindings, { summaryId: summary.id, summaryVersion: 1, conformityDecisionId: decision.id, conformityOutcome: "machine-conforme" });
      assert.deepEqual([result.template, result.source, result.file], [candidate.template, null, candidate.file]);
      assert.ok(!("storageRef" in result) && !reply.text.includes("reports/"));
      assert.equal(await count(pool, "official_reports"), 1);
      assert.equal(await fingerprint(pool, untouchedTables), before, "no other table changes");
      assert.equal(await count(pool, "audit_review_accesses"), accesses);
      assert.deepEqual(calls, io, "no storage call");
    });
  });
});

test("D2 a ready uploaded PDF candidate designates with source and no template; both decision outcomes designate", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      for (const outcome of ["machine-conforme", "machine-non-conforme"] as const) {
        const { taskId } = await readyTask(fixture, outcome);
        const file = storedFileSchema.parse((await upload(fixture, taskId)).body);
        const candidate = candidateOf(await attach(fixture, taskId, file.id));
        const reply = await designate(fixture, taskId, candidate.id);
        assert.equal(reply.status, 201, reply.text);
        const result = officialOf(reply);
        assert.deepEqual([result.origin, result.template, result.source, result.bindings.conformityOutcome], ["uploaded-pdf", null, { fileId: file.id }, outcome]);
        assert.deepEqual(result.file, { name: file.fileName, byteSize: file.byteSize, sha256: file.sha256 });
      }
      const word = await readyWord(fixture, "machine-non-conforme");
      assert.equal(officialOf(await designate(fixture, word.taskId, word.candidate.id)).bindings.conformityOutcome, "machine-non-conforme");
    });
  });
});

test("D3 a generating or failed candidate is not ready (409) and nothing is written", async () => {
  const blocked = blockedGenerator();
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const pending = generate(fixture, taskId);
      await blocked.hasStarted;
      const generating = reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates;
      assert.deepEqual(generating.map((candidate) => candidate.status), ["generating"]);
      const reply = await designate(fixture, taskId, generating[0]!.id);
      assert.deepEqual([reply.status, reply.body], [409, NOT_READY]);
      blocked.release();
      assert.equal((await pending).status, 201);
      assert.equal(await count(pool, "official_reports"), 0);
    });
  }, { generate: blocked.generate });
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      assert.equal((await generate(fixture, taskId)).status, 502);
      const failed = reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates;
      assert.deepEqual(failed.map((candidate) => candidate.status), ["failed"]);
      assert.deepEqual([(await designate(fixture, taskId, failed[0]!.id)).body], [NOT_READY]);
      assert.equal(await count(fixture.pool, "official_reports"), 0);
    });
  }, { generate: async () => { throw new Error("échec simulé"); } });
});

test("D4 a stale candidate (reopened summary, re-decision, outdated outcome, other revision, file no longer ready) is refused with 409 and nothing is written", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId, candidate } = await readyWord(fixture);
      assert.equal((await reopen(fixture, taskId)).status, 201);
      assert.equal((await statuses(fixture, taskId)).get(candidate.id), "outdated");
      assert.deepEqual((await designate(fixture, taskId, candidate.id)).body, OUTDATED);
      assert.equal((await confirm(fixture, taskId)).status, 201);
      assert.deepEqual((await designate(fixture, taskId, candidate.id)).body, OUTDATED, "reconfirmed but no decision");
      assert.equal((await decide(fixture, taskId, "machine-non-conforme")).status, 201);
      assert.deepEqual((await designate(fixture, taskId, candidate.id)).body, OUTDATED, "old candidate stays outdated");
      const fresh = candidateOf(await generate(fixture, taskId));
      assert.equal(await count(pool, "official_reports"), 0);
      assert.equal((await designate(fixture, taskId, fresh.id)).status, 201, "the fresh candidate designates");
    });
  });
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId, candidate } = await readyWord(fixture);
      reviewCommandTestSeams.snapshot = (snapshot) => ({ ...snapshot, revision: snapshot.revision + 1 });
      assert.deepEqual((await designate(fixture, taskId, candidate.id)).body, OUTDATED, "other audit revision");
      reviewCommandTestSeams.snapshot = undefined;
      assert.equal(await count(fixture.pool, "official_reports"), 0);
    });
  });
  const blocked = blockedGenerator();
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const pending = generate(fixture, taskId);
      await blocked.hasStarted;
      assert.equal((await reopen(fixture, taskId)).status, 201);
      blocked.release();
      assert.equal((await pending).status, 409);
      const outdated = reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates[0]!;
      assert.equal(outdated.status, "outdated");
      assert.equal((await confirm(fixture, taskId)).status, 201);
      assert.equal((await decide(fixture, taskId)).status, 201);
      assert.deepEqual((await designate(fixture, taskId, outdated.id)).body, OUTDATED, "outdated outcome");
    });
  }, { generate: blocked.generate });
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const file = storedFileSchema.parse((await upload(fixture, taskId)).body);
      const candidate = candidateOf(await attach(fixture, taskId, file.id));
      await pool.query("INSERT INTO stored_file_checks (file_id, stage, result, scanner) VALUES ($1, 'scan', 'threat', 'clamav')", [file.id]);
      assert.deepEqual((await designate(fixture, taskId, candidate.id)).body, OUTDATED, "PDF no longer ready");
      assert.equal(await count(pool, "official_reports"), 0);
    });
  });
});

test("D5 exactly one: the same candidate replays 200, another is refused 409, concurrent designations leave one row", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId, candidate } = await readyWord(fixture);
      const second = candidateOf(await generate(fixture, taskId));
      const first = await designate(fixture, taskId, candidate.id);
      assert.equal(first.status, 201);
      const replay = await designate(fixture, taskId, candidate.id);
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.body, first.body);
      assert.deepEqual(await designate(fixture, taskId, second.id).then((reply) => [reply.status, reply.body]), [409, ALREADY_OFFICIAL]);
      assert.equal(await count(pool, "official_reports"), 1);
    });
  });
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId, candidate } = await readyWord(fixture);
      const replies = await Promise.all([designate(fixture, taskId, candidate.id), designate(fixture, taskId, candidate.id)]);
      assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 201]);
      assert.equal(await count(fixture.pool, "official_reports"), 1);
    });
  });
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId, candidate } = await readyWord(fixture);
      const other = candidateOf(await generate(fixture, taskId));
      const replies = await Promise.all([designate(fixture, taskId, candidate.id), designate(fixture, taskId, other.id)]);
      assert.deepEqual(replies.map((reply) => reply.status).sort(), [201, 409]);
      assert.equal(await count(fixture.pool, "official_reports"), 1);
    });
  });
});

test("D6 refusals: Employé 403, unknown/other-team/draft/malformed ids 404 with an identical body, invalid body 422; nothing is written", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId, candidate } = await readyWord(fixture);
      const other = await readyWord(fixture);
      const draftTask = await fixture.newTask(fixture.employee);
      const before = await fingerprint(pool, untouchedTables);
      assert.deepEqual((await designate(fixture, taskId, candidate.id, fixture.tokens.employee)).body, FORBIDDEN);
      assert.equal((await designate(fixture, taskId, candidate.id, fixture.tokens.employee)).status, 403);
      const cases: Array<[string, string, string, string | null]> = [
        ["unknown task", randomUUID(), candidate.id, null], ["malformed task", "not-a-uuid", candidate.id, null], ["malformed candidate", taskId, "not-a-uuid", null],
        ["unknown candidate", taskId, randomUUID(), null], ["candidate of another task", taskId, other.candidate.id, null],
        ["other team", taskId, candidate.id, fixture.tokens.otherOwner], ["draft task", draftTask, candidate.id, null],
      ];
      for (const [label, task, id, token] of cases) {
        const reply = await designate(fixture, task, id, token ?? fixture.tokens.owner);
        assert.deepEqual([reply.status, reply.body], [404, NOT_FOUND], label);
      }
      for (const body of [{ extra: true }, { candidateId: candidate.id }, []]) {
        const reply = await designate(fixture, taskId, candidate.id, fixture.tokens.owner, body);
        assert.deepEqual([reply.status, reply.body], [422, INVALID], JSON.stringify(body));
      }
      assert.deepEqual((await designate(fixture, randomUUID(), candidate.id, fixture.tokens.owner, { extra: true })).body, NOT_FOUND, "an unknown task stays 404 with an invalid body");
      assert.equal((await call(fixture, "POST", `/tasks/${taskId}/report-candidates/${candidate.id}/designate`, null, {})).status, 401);
      assert.equal(await count(pool, "official_reports"), 0);
      assert.equal(await fingerprint(pool, untouchedTables), before);
    });
  });
});

test("D7 statuses: official for the designated candidate, superseded for other formerly ready ones; outdated and failed unchanged", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId, candidate: outdated } = await readyWord(fixture);
      assert.equal((await reopen(fixture, taskId)).status, 201);
      assert.equal((await confirm(fixture, taskId)).status, 201);
      assert.equal((await decide(fixture, taskId)).status, 201);
      const word = candidateOf(await generate(fixture, taskId));
      const file = storedFileSchema.parse((await upload(fixture, taskId)).body);
      const pdf = candidateOf(await attach(fixture, taskId, file.id));
      const rowsBefore = await fingerprint(pool, ["report_candidates", "report_candidate_outcomes"]);
      assert.deepEqual([...(await statuses(fixture, taskId)).values()].sort(), ["outdated", "ready", "ready"]);
      assert.equal((await designate(fixture, taskId, pdf.id)).status, 201);
      const after = await statuses(fixture, taskId);
      assert.deepEqual([after.get(pdf.id), after.get(word.id), after.get(outdated.id)], ["official", "superseded", "outdated"]);
      assert.equal(await fingerprint(pool, ["report_candidates", "report_candidate_outcomes"]), rowsBefore, "no candidate row changed");
      const listed = reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates.find((candidate) => candidate.id === pdf.id)!;
      assert.deepEqual([listed.bindings, listed.file], [pdf.bindings, pdf.file]);
    });
  });
});

test("D8 after designation no new candidate can be created and the in-flight generation ends superseded; summary mutations stay refused", async () => {
  const blocked = blockedGenerator();
  let gated = false;
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId, candidate } = await readyWord(fixture);
      gated = true;
      const pending = generate(fixture, taskId);
      await blocked.hasStarted;
      assert.equal((await designate(fixture, taskId, candidate.id)).status, 201);
      blocked.release();
      assert.equal((await pending).status, 201, "the in-flight attempt keeps its evidence");
      const after = await statuses(fixture, taskId);
      assert.deepEqual([...after.values()].sort(), ["official", "superseded"]);
      const file = storedFileSchema.parse((await upload(fixture, taskId)).body);
      const rows = await count(pool, "report_candidates");
      const generated = await generate(fixture, taskId);
      assert.deepEqual([generated.status, generated.body], [409, OFFICIAL_DESIGNATED]);
      const attached = await attach(fixture, taskId, file.id);
      assert.deepEqual([attached.status, attached.body], [409, OFFICIAL_DESIGNATED]);
      assert.equal(await count(pool, "report_candidates"), rows);
      assert.equal((await generate(fixture, randomUUID())).status, 404);
      assert.equal((await generate(fixture, taskId, fixture.tokens.otherOwner)).status, 404);
      assert.equal((await confirm(fixture, taskId)).status, 409);
      assert.equal((await decide(fixture, taskId, "machine-non-conforme")).status, 409);
      assert.equal((await call(fixture, "POST", `/tasks/${taskId}/manual-insights`, fixture.tokens.owner, { text: "Ajout tardif." })).status, 409);
      assert.equal((await call(fixture, "POST", `/tasks/${taskId}/summary-drafts`, fixture.tokens.owner, {})).status, 409);
      for (const statement of ["UPDATE official_reports SET designated_at = now()", "DELETE FROM official_reports"]) {
        await assert.rejects(pool.query(statement));
      }
    });
  }, { generate: (document) => (gated ? blocked.generate(document) : createWordTemplateGenerator().generate(document)) });
});

test("D9 the reports participant gives the reopening veto a production effect, per task and submission", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      registerDefaultSummaryReopenParticipants();
      registerDefaultSummaryReopenParticipants();
      const designated = await readyWord(fixture);
      const free = await readyWord(fixture);
      assert.equal((await designate(fixture, designated.taskId, designated.candidate.id)).status, 201);
      const reopenings = await count(pool, "summary_reopenings");
      const invalidations = await count(pool, "conformity_decision_invalidations");
      const refused = await reopen(fixture, designated.taskId);
      assert.deepEqual([refused.status, refused.body], [409, SUMMARY_DESIGNATED]);
      assert.equal(await count(pool, "summary_reopenings"), reopenings);
      assert.equal(await count(pool, "conformity_decision_invalidations"), invalidations, "no participant is notified");
      assert.equal((await reopen(fixture, free.taskId)).status, 201, "designation on one task does not veto another");
      assert.equal((await statuses(fixture, free.taskId)).get(free.candidate.id), "outdated");
    });
  });
});

test("D10 GET official-report: 200 for the owner after designation with the same body, 404 otherwise, Employé 403, no access row", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId, candidate } = await readyWord(fixture);
      const before = await official(fixture, taskId);
      assert.deepEqual([before.status, before.body], [404, NOT_FOUND]);
      const created = await designate(fixture, taskId, candidate.id);
      const accesses = await count(pool, "audit_review_accesses");
      const read = await official(fixture, taskId);
      assert.equal(read.status, 200);
      assert.match(read.cacheControl ?? "", /no-store/i);
      assert.deepEqual(read.body, created.body);
      for (const [label, task, token] of [["unknown", randomUUID(), fixture.tokens.owner], ["malformed", "not-a-uuid", fixture.tokens.owner], ["other team", taskId, fixture.tokens.otherOwner]] as const) {
        const reply = await official(fixture, task, token);
        assert.deepEqual([reply.status, reply.body], [404, NOT_FOUND], label);
      }
      assert.deepEqual((await official(fixture, taskId, fixture.tokens.employee)).body, FORBIDDEN);
      assert.equal((await official(fixture, taskId, null)).status, 401);
      assert.equal(await count(pool, "audit_review_accesses"), accesses);
    });
  });
});

test("D11 official_reports is insert-only; migration 0025 applies on top of 0024 data", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool, owner } = fixture;
      const { taskId, submissionId, summary, decision } = await readyTask(fixture);
      assert.equal((await pool.query("SELECT to_regclass('official_reports') AS name")).rows[0]!.name, null, "0025 is not applied yet");
      const audit = (await pool.query<{ audit_id: string }>("SELECT audit_id FROM audit_submissions WHERE id = $1", [submissionId])).rows[0]!;
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version, conformity_decision_id, origin, template_id, template_version, requested_by)
         VALUES ($1, $2, $3, $4, 1, $5, 1, $6, 'generated-word', 'cetem-paper-report', '1.0.0', $7) RETURNING id`,
        [randomUUID(), taskId, audit.audit_id, submissionId, summary.id, decision.id, owner]);
      const candidate = { id: inserted.rows[0]!.id };
      await pool.query("INSERT INTO report_candidate_outcomes (candidate_id, outcome, storage_ref, file_name, byte_size, sha256) VALUES ($1, 'ready', 'reports/x.docx', 'x.docx', 1, repeat('a', 64))", [candidate.id]);
      const before = await fingerprint(pool, untouchedTables);
      await migrate(pool);
      assert.equal(await fingerprint(pool, untouchedTables), before, "existing rows are not rewritten");
      assert.equal((await pool.query("SELECT version FROM schema_migrations WHERE version LIKE '0025%'")).rows.length, 1);
      assert.equal((await statuses(fixture, taskId)).get(candidate.id), "ready");
      assert.equal((await designate(fixture, taskId, candidate.id)).status, 201);
      await assert.rejects(pool.query("INSERT INTO official_reports (task_id, candidate_id, submission_id, designated_by) VALUES ($1, $2, $3, $4)", [taskId, candidate.id, submissionId, owner]));
      await assert.rejects(pool.query("UPDATE official_reports SET designated_by = designated_by"));
      await assert.rejects(pool.query("DELETE FROM official_reports"));
      await assert.rejects(pool.query("TRUNCATE official_reports"));
      assert.equal(await count(pool, "official_reports"), 1);
    }, { migrateThrough: "0024_report_pdf_candidates" });
  });
});

test("D11b the second candidate of a task and a second row for the same candidate are rejected by PostgreSQL", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool, owner } = fixture;
      const { taskId, submissionId, candidate } = await readyWord(fixture);
      const second = candidateOf(await generate(fixture, taskId));
      assert.equal((await designate(fixture, taskId, candidate.id)).status, 201);
      await assert.rejects(pool.query("INSERT INTO official_reports (task_id, candidate_id, submission_id, designated_by) VALUES ($1, $2, $3, $4)", [taskId, second.id, submissionId, owner]), /duplicate key|unique/i);
      const otherTask = await readyWord(fixture);
      await assert.rejects(pool.query("INSERT INTO official_reports (task_id, candidate_id, submission_id, designated_by) VALUES ($1, $2, $3, $4)", [otherTask.taskId, candidate.id, otherTask.submissionId, owner]), /duplicate key|unique/i);
    });
  });
});

test("D12 logs carry only the event, the actor and a fixed class: no IDs, names or paths", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { owner } = fixture;
      const { taskId, candidate } = await readyWord(fixture);
      const second = candidateOf(await generate(fixture, taskId));
      const { lines } = await captureInfo(async () => {
        await designate(fixture, taskId, candidate.id, fixture.tokens.employee);
        await designate(fixture, randomUUID(), candidate.id);
        await designate(fixture, taskId, candidate.id);
        await designate(fixture, taskId, candidate.id);
        await designate(fixture, taskId, second.id);
        await generate(fixture, taskId);
        await official(fixture, randomUUID());
      });
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, string>);
      for (const line of parsed) {
        assert.ok(Object.keys(line).every((key) => ["event", "actorId", "class"].includes(key)), JSON.stringify(line));
        assert.ok(line.actorId === owner || line.actorId === fixture.employee);
      }
      assert.equal(parsed.filter((line) => line.event === "report.official.designated").length, 1);
      const classes = new Set(parsed.filter((line) => line.event === "report.official.refused").map((line) => line.class));
      for (const expected of ["forbidden-role", "not-found", "already-official"]) assert.ok(classes.has(expected), expected);
      assert.ok(parsed.some((line) => line.event === "report.candidate.refused" && line.class === "official-designated"));
      const everything = lines.join("\n");
      for (const secret of [taskId, candidate.id, second.id, candidate.attemptId, "reports/", ".docx"]) assert.ok(!everything.includes(secret), secret);
    });
  });
});

test("U2 reportsReopenParticipant answers per task and submission and writes nothing when notified", async () => {
  await withOfficial(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const a = await readyWord(fixture);
      const b = await readyWord(fixture);
      assert.equal((await designate(fixture, a.taskId, a.candidate.id)).status, 201);
      const client = await pool.connect();
      try {
        assert.equal(await reportsReopenParticipant.hasOfficialDesignation(client, { taskId: a.taskId, submissionId: a.submissionId }), true);
        assert.equal(await reportsReopenParticipant.hasOfficialDesignation(client, { taskId: b.taskId, submissionId: b.submissionId }), false);
        assert.equal(await reportsReopenParticipant.hasOfficialDesignation(client, { taskId: a.taskId, submissionId: b.submissionId }), false);
        const before = await fingerprint(pool, [...untouchedTables, "official_reports"]);
        await reportsReopenParticipant.onSummaryReopened(client, { taskId: a.taskId, submissionId: a.submissionId, reopenedSummaryId: a.summary.id, reopenedAt: new Date().toISOString(), actorId: fixture.owner });
        assert.equal(await fingerprint(pool, [...untouchedTables, "official_reports"]), before);
      } finally { client.release(); }
    });
  });
});
