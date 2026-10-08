import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { confirmedSummarySchema, conformityDecisionSchema, reportCandidateListSchema, reportCandidateSchema, storedFileSchema } from "@cetem-qc/schemas/api/v1";
import type { ReportCandidate, StoredFile } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { migrate } from "./db/migrate.js";
import { createMemoryObjectStorage, createPdfScanner, fileCommandTestSeams, getFileScanResults, getStoredFileStatus } from "./modules/files/index.js";
import type { PdfScanner, ScanResult } from "./modules/files/index.js";
import { reportCommandTestSeams } from "./modules/reports/index.js";
import { registerDefaultSummaryReopenParticipants } from "./register-participants.js";
import { buildPdf, pdfWithToken } from "./test-support/pdf-fixtures.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 11.3: report candidates from a ready PDF (synthetic PDFs, in-memory storage, scanner none or fake; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const NOT_READY = { error: { code: "REPORT_FILE_NOT_READY", message: "Ce fichier n’est pas prêt : il doit être validé et analysé avant de devenir un candidat de rapport." } };
const ALREADY = { error: { code: "REPORT_FILE_ALREADY_ATTACHED", message: "Ce fichier est déjà un candidat de rapport pour les données actuelles." } };
const ATTEMPT = { error: { code: "REPORT_ATTEMPT_CONFLICT", message: "Cette demande est invalide." } };

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
async function upload(fixture: SyncFixture, taskId: string, bytes: Buffer = buildPdf(), token: string | null = fixture.tokens.owner): Promise<Reply> {
  const response = await fetch(`${fixture.apiRoot}/tasks/${taskId}/pdf-files`, {
    method: "POST",
    headers: { "content-type": "application/pdf", "x-attempt-id": randomUUID(), "x-file-name": "Rapport signé.pdf", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: new Uint8Array(bytes),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: response.headers.get("cache-control") };
}
const rescan = (fixture: SyncFixture, taskId: string, fileId: string) => call(fixture, "POST", `/tasks/${taskId}/pdf-files/${fileId}/scan-retries`, fixture.tokens.owner, undefined);
const fileOf = (reply: Reply): StoredFile => storedFileSchema.parse(reply.body);
const candidateOf = (reply: Reply): ReportCandidate => reportCandidateSchema.parse(reply.body);
const attach = (fixture: SyncFixture, taskId: string, fileId: string, attemptId: string | undefined = randomUUID(), token: string | null = fixture.tokens.owner, body: unknown = { attemptId }) =>
  call(fixture, "POST", `/tasks/${taskId}/pdf-files/${fileId}/report-candidate`, token, body);
const list = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner) => call(fixture, "GET", `/tasks/${taskId}/report-candidates`, token);
const downloadCandidate = async (fixture: SyncFixture, taskId: string, candidateId: string, token: string | null = fixture.tokens.owner) => {
  const response = await fetch(`${fixture.apiRoot}/tasks/${taskId}/report-candidates/${candidateId}/file`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
};
const confirm = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, fixture.tokens.owner, { text: "Synthèse finale." });
const reopen = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/summary-reopening`, fixture.tokens.owner, {});
const decide = (fixture: SyncFixture, taskId: string, outcome = "machine-conforme") => call(fixture, "POST", `/tasks/${taskId}/conformity-decision`, fixture.tokens.owner, { outcome });
const errorCode = (reply: Reply) => (reply.body.error as { code: string } | undefined)?.code ?? reply.text;

async function acceptedTask(fixture: SyncFixture) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload({ "header.reportNumber": "R-301" })), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}
async function readyTask(fixture: SyncFixture, outcome = "machine-conforme") {
  const accepted = await acceptedTask(fixture);
  const summary = confirmedSummarySchema.parse((await confirm(fixture, accepted.taskId)).body);
  const decision = conformityDecisionSchema.parse((await decide(fixture, accepted.taskId, outcome)).body);
  return { ...accepted, summary, decision };
}

interface CandidateRow { id: string; attempt_id: string; task_id: string; audit_id: string; submission_id: string; audit_revision: number; confirmed_summary_id: string; summary_version: number; conformity_decision_id: string; origin: string; template_id: string | null; template_version: string | null; stored_file_id: string | null; requested_by: string }
interface OutcomeRow { candidate_id: string; outcome: string; storage_ref: string | null; file_name: string | null; byte_size: number | null; sha256: string | null }
const candidateRows = async (pool: Pool) => (await pool.query<CandidateRow>("SELECT * FROM report_candidates ORDER BY seq")).rows;
const outcomeRows = async (pool: Pool) => (await pool.query<OutcomeRow>("SELECT * FROM report_candidate_outcomes ORDER BY seq")).rows;
const reportCount = async (pool: Pool) => `${(await candidateRows(pool)).length}/${(await outcomeRows(pool)).length}`;

async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const untouchedTables = ["tasks", "task_assignments", "audits", "audit_revisions", "audit_submissions", "audit_insight_decisions", "audit_manual_insights",
  "audit_review_accesses", "summary_ai_drafts", "confirmed_summaries", "summary_reopenings", "conformity_decisions", "conformity_decision_invalidations",
  "stored_files", "stored_file_checks"];

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

interface FakeScanner extends PdfScanner { calls: number; next: ScanResult }
interface Context { storage: ReturnType<typeof createMemoryObjectStorage>; scanner: FakeScanner; calls: { get: number; put: number } }

/** Installs a counting memory storage (for files and reports) and a controllable scanner (or `none`) for one test. */
async function withPdfReports<T>(run: (context: Context) => Promise<T>, options: { scanner?: ScanResult | "none" } = {}): Promise<T> {
  const inner = createMemoryObjectStorage();
  const calls = { get: 0, put: 0 };
  const storage = Object.assign(Object.create(inner) as typeof inner, {
    get: async (key: string) => { calls.get++; return inner.get(key); },
    put: async (key: string, bytes: Uint8Array) => { calls.put++; await inner.put(key, bytes); },
  });
  const none = createPdfScanner({});
  const scanner: FakeScanner = { id: "clamav", calls: 0, next: options.scanner && options.scanner !== "none" ? options.scanner : "clean", scan: async () => { scanner.calls++; return scanner.next; } };
  fileCommandTestSeams.storage = storage;
  fileCommandTestSeams.scanner = options.scanner === "none" ? none : scanner;
  reportCommandTestSeams.storage = storage;
  try { return await run({ storage: inner, scanner, calls }); } finally {
    fileCommandTestSeams.storage = undefined;
    fileCommandTestSeams.scanner = undefined;
    reportCommandTestSeams.storage = undefined;
    registerDefaultSummaryReopenParticipants();
  }
}

test("B1 B2 a later non-ready file state reads outdated in the list and refuses designation; a later clean scan makes it ready again", async () => {
  await withPdfReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const file = fileOf(await upload(fixture, taskId));
      const candidate = candidateOf(await attach(fixture, taskId, file.id));
      const statusOf = async () => reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates.map((item) => item.status);
      const designate = () => call(fixture, "POST", `/tasks/${taskId}/report-candidates/${candidate.id}/designate`, fixture.tokens.owner, {});
      assert.deepEqual(await statusOf(), ["ready"]);
      const reports = () => fingerprint(pool, ["report_candidates", "report_candidate_outcomes"]);
      const before = await reports();
      await pool.query("INSERT INTO stored_file_checks (file_id, stage, result, scanner) VALUES ($1, 'scan', 'unavailable', 'clamav')", [file.id]);
      assert.deepEqual(await statusOf(), ["outdated"]);
      assert.equal(await reports(), before, "the candidate and outcome rows are untouched");
      const refused = await designate();
      assert.deepEqual([refused.status, errorCode(refused)], [409, "REPORT_CANDIDATE_OUTDATED"]);
      await pool.query("INSERT INTO stored_file_checks (file_id, stage, result, scanner) VALUES ($1, 'scan', 'clean', 'clamav')", [file.id]);
      assert.deepEqual(await statusOf(), ["ready"]);
      await pool.query("INSERT INTO stored_file_checks (file_id, stage, result, scanner) VALUES ($1, 'scan', 'threat', 'clamav')", [file.id]);
      assert.deepEqual(await statusOf(), ["outdated"]);
      const threat = await designate();
      assert.deepEqual([threat.status, errorCode(threat)], [409, "REPORT_CANDIDATE_OUTDATED"]);
    });
  });
});

test("P1 P2 ready file (none or clean scanner), either decision: 201 uploaded-pdf ready, bound to the current inputs; one candidate row, one outcome row, no storage key, no new object", async () => {
  for (const scannerKind of ["none", "clean"] as const) {
    await withPdfReports(async ({ storage, calls }) => {
      await withSyncFixture(async (fixture) => {
        const { pool, owner } = fixture;
        for (const outcome of ["machine-conforme", "machine-non-conforme"] as const) {
          const { taskId, submissionId, summary, decision } = await readyTask(fixture, outcome);
          const file = fileOf(await upload(fixture, taskId));
          assert.equal(file.status, "ready");
          const objects = storage.keys().length;
          const putsBefore = calls.put;
          const attemptId = randomUUID();
          const reply = await attach(fixture, taskId, file.id, attemptId);
          assert.equal(reply.status, 201, reply.text);
          assert.match(reply.cacheControl ?? "", /no-store/i);
          const candidate = candidateOf(reply);
          assert.deepEqual([candidate.origin, candidate.status, candidate.attemptId, candidate.template, candidate.failureClass], ["uploaded-pdf", "ready", attemptId, null, null]);
          assert.deepEqual(candidate.source, { fileId: file.id, scanResult: scannerKind === "none" ? "not-performed" : "clean" });
          assert.deepEqual(candidate.bindings, { auditRevision: 1, summaryId: summary.id, summaryVersion: 1, conformityDecisionId: decision.id, conformityOutcome: outcome });
          assert.deepEqual(candidate.file, { name: file.fileName, byteSize: file.byteSize, sha256: file.sha256 });
          assert.deepEqual(candidate.requestedBy, { id: owner, displayName: "Responsable Test" });
          assert.ok(!("official" in candidate) && !("storageRef" in candidate));
          const row = (await candidateRows(pool)).find((candidateRow) => candidateRow.id === candidate.id)!;
          assert.deepEqual([row.task_id, row.submission_id, row.audit_revision, row.confirmed_summary_id, row.summary_version, row.conformity_decision_id, row.origin, row.stored_file_id, row.template_id, row.template_version],
            [taskId, submissionId, 1, summary.id, 1, decision.id, "uploaded-pdf", file.id, null, null]);
          const stored = (await outcomeRows(pool)).find((outcomeRow) => outcomeRow.candidate_id === candidate.id)!;
          assert.deepEqual([stored.outcome, stored.storage_ref, stored.file_name, stored.byte_size, stored.sha256], ["ready", null, file.fileName, file.byteSize, file.sha256]);
          assert.equal(storage.keys().length, objects, "no new object");
          assert.equal(calls.put, putsBefore);
          assert.ok(!reply.text.includes("files/pdf/"));
        }
      });
    }, { scanner: scannerKind });
  }
});

test("P3 files that are not ready give 409 REPORT_FILE_NOT_READY and write nothing; after a rescan to ready the same file attaches", async () => {
  await withPdfReports(async ({ scanner, storage }) => {
    await withSyncFixture(async (fixture) => {
      const { pool, owner } = fixture;
      const { taskId } = await readyTask(fixture);
      const rejected = fileOf(await upload(fixture, taskId, Buffer.from("not a pdf")));
      const quarantined = fileOf(await upload(fixture, taskId, pdfWithToken("/JavaScript")));
      scanner.next = "threat";
      const threat = fileOf(await upload(fixture, taskId));
      scanner.next = "unavailable";
      const scanFailed = fileOf(await upload(fixture, taskId));
      const pdf = buildPdf();
      const pendingId = randomUUID();
      await pool.query("INSERT INTO stored_files (id, attempt_id, task_id, kind, display_name, byte_size, sha256, storage_ref, uploaded_by) VALUES ($1, $2, $3, 'manual-pdf', 'Forgé.pdf', $4, 'a', $5, $6)", [pendingId, randomUUID(), taskId, pdf.length, `files/pdf/${pendingId}.pdf`, owner]);
      await pool.query("INSERT INTO stored_file_checks (file_id, stage, result) VALUES ($1, 'validation', 'passed'), ($1, 'storage', 'passed')", [pendingId]);
      await storage.put(`files/pdf/${pendingId}.pdf`, new Uint8Array(pdf));
      const failedId = randomUUID();
      await pool.query("INSERT INTO stored_files (id, attempt_id, task_id, kind, display_name, byte_size, sha256, storage_ref, uploaded_by) VALUES ($1, $2, $3, 'manual-pdf', 'Échec.pdf', 1, 'a', NULL, $4)", [failedId, randomUUID(), taskId, owner]);
      await pool.query("INSERT INTO stored_file_checks (file_id, stage, result) VALUES ($1, 'validation', 'passed')", [failedId]);
      await pool.query("INSERT INTO stored_file_checks (file_id, stage, result, failure_class) VALUES ($1, 'storage', 'failed', 'storage-failed')", [failedId]);
      const before = await fingerprint(pool, untouchedTables);
      const cases: Array<[string, string, string]> = [["rejected", rejected.id, "rejected"], ["quarantined", quarantined.id, "quarantined"], ["threat", threat.id, "quarantined"],
        ["scan-failed", scanFailed.id, "scan-failed"], ["scan-pending", pendingId, "scan-pending"], ["storage-failed", failedId, "storage-failed"]];
      for (const [label, id, status] of cases) {
        assert.equal(await getStoredFileStatus(pool, { taskId, fileId: id }), status, label);
        const reply = await attach(fixture, taskId, id);
        assert.deepEqual([reply.status, reply.body], [409, NOT_READY], label);
      }
      assert.equal(await reportCount(pool), "0/0");
      assert.equal(await fingerprint(pool, untouchedTables), before);
      scanner.next = "clean";
      assert.equal(fileOf(await rescan(fixture, taskId, scanFailed.id)).status, "ready");
      assert.equal((await attach(fixture, taskId, scanFailed.id)).status, 201);
      assert.equal(await reportCount(pool), "1/1");
    });
  });
});

test("P4 refusals: Employé 403; malformed, unknown, other-team, draft, no-audit task and unknown or other-task file 404; invalid body 422; summary open 409; no decision 409; nothing written", async () => {
  await withPdfReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const other = await readyTask(fixture);
      const file = fileOf(await upload(fixture, taskId));
      const otherFile = fileOf(await upload(fixture, other.taskId));
      const draftTask = await fixture.newTask(fixture.employee);
      const noAudit = await fixture.newTask(fixture.employee);
      assert.equal((await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-D" })), fixture.tokens.employee)).status, 200);
      for (const token of [fixture.tokens.employee, fixture.tokens.colleague]) {
        const reply = await attach(fixture, taskId, file.id, randomUUID(), token);
        assert.deepEqual([reply.status, reply.body], [403, FORBIDDEN]);
      }
      assert.equal((await attach(fixture, taskId, file.id, randomUUID(), null)).status, 401);
      const notFounds: Array<[string, string, string, string | null]> = [
        ["malformed task", "not-a-uuid", file.id, null], ["malformed file", taskId, "not-a-uuid", null], ["unknown task", randomUUID(), file.id, null], ["unknown file", taskId, randomUUID(), null],
        ["draft", draftTask, file.id, null], ["no audit", noAudit, file.id, null], ["file of another task", taskId, otherFile.id, null], ["other team", taskId, file.id, fixture.tokens.otherOwner],
      ];
      for (const [label, task, id, token] of notFounds) {
        const reply = await attach(fixture, task, id, randomUUID(), token ?? fixture.tokens.owner);
        assert.deepEqual([reply.status, reply.body], [404, NOT_FOUND], label);
      }
      for (const [label, task, token] of [["unknown task", randomUUID(), null], ["draft", draftTask, null], ["other team", taskId, fixture.tokens.otherOwner]] as const) {
        const invalid = await attach(fixture, task, file.id, undefined, token ?? fixture.tokens.owner, {});
        assert.deepEqual([invalid.status, invalid.body], [404, NOT_FOUND], `${label} with invalid body`);
      }
      for (const body of [{}, { attemptId: "x" }, { attemptId: randomUUID(), extra: 1 }, undefined]) {
        const reply = body === undefined
          ? await call(fixture, "POST", `/tasks/${taskId}/pdf-files/${file.id}/report-candidate`, fixture.tokens.owner)
          : await attach(fixture, taskId, file.id, undefined, fixture.tokens.owner, body);
        assert.deepEqual([reply.status, errorCode(reply)], [422, "VALIDATION_FAILED"], `${JSON.stringify(body)} ${reply.text}`);
      }
      assert.equal(await reportCount(pool), "0/0");
      assert.equal((await reopen(fixture, taskId)).status, 201);
      const open = await attach(fixture, taskId, file.id);
      assert.deepEqual([open.status, errorCode(open)], [409, "SUMMARY_NOT_CONFIRMED"]);
      assert.equal((await confirm(fixture, taskId)).status, 201);
      const undecided = await attach(fixture, taskId, file.id);
      assert.deepEqual([undecided.status, errorCode(undecided)], [409, "CONFORMITY_NOT_DECIDED"]);
      assert.equal(await reportCount(pool), "0/0");
    });
  });
});

test("P5 idempotency: replay 200; another file, task or Word attempt 409; same file and bindings 409; concurrent duplicates leave one candidate", async () => {
  await withPdfReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const other = await readyTask(fixture);
      const file = fileOf(await upload(fixture, taskId));
      const second = fileOf(await upload(fixture, taskId));
      const otherFile = fileOf(await upload(fixture, other.taskId));
      const attemptId = randomUUID();
      const first = await attach(fixture, taskId, file.id, attemptId);
      assert.equal(first.status, 201);
      const replay = await attach(fixture, taskId, file.id, attemptId);
      assert.deepEqual([replay.status, replay.body], [200, first.body]);
      assert.equal(await reportCount(pool), "1/1");
      for (const [label, task, id] of [["other file", taskId, second.id], ["other task", other.taskId, otherFile.id]] as const) {
        const reply = await attach(fixture, task, id, attemptId);
        assert.deepEqual([reply.status, reply.body], [409, ATTEMPT], label);
      }
      const wordAttempt = randomUUID();
      assert.equal((await call(fixture, "POST", `/tasks/${other.taskId}/report-candidates`, fixture.tokens.owner, { attemptId: wordAttempt })).status, 201);
      const wordConflict = await attach(fixture, taskId, second.id, wordAttempt);
      assert.deepEqual([wordConflict.status, wordConflict.body], [409, ATTEMPT]);
      const again = await attach(fixture, taskId, file.id, randomUUID());
      assert.deepEqual([again.status, again.body], [409, ALREADY]);
      assert.equal(await reportCount(pool), "2/2");

      const concurrentAttempt = randomUUID();
      const same = await Promise.all([attach(fixture, taskId, second.id, concurrentAttempt), attach(fixture, taskId, second.id, concurrentAttempt)]);
      assert.deepEqual(same.map((reply) => reply.status).sort(), [200, 201]);
      assert.equal(await reportCount(pool), "3/3");
      const third = fileOf(await upload(fixture, taskId));
      const different = await Promise.all([attach(fixture, taskId, third.id), attach(fixture, taskId, third.id)]);
      assert.deepEqual(different.map((reply) => reply.status).sort(), [201, 409]);
      assert.equal(await reportCount(pool), "4/4");
    });
  });
});

test("P6 freshness: reopening or re-decision makes the candidate outdated but downloadable; the file attaches again to new bindings", async () => {
  await withPdfReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const pdf = buildPdf();
      const file = fileOf(await upload(fixture, taskId, pdf));
      const candidate = candidateOf(await attach(fixture, taskId, file.id));
      const statusOf = async (id: string) => reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates.find((entry) => entry.id === id)!.status;
      assert.equal(await statusOf(candidate.id), "ready");
      const before = await reportCount(pool);
      assert.equal((await reopen(fixture, taskId)).status, 201);
      assert.equal(await reportCount(pool), before, "a reopening writes nothing to the report tables");
      assert.equal(await statusOf(candidate.id), "outdated");
      const download = await downloadCandidate(fixture, taskId, candidate.id);
      assert.equal(download.status, 200);
      assert.ok(download.bytes.equals(pdf));
      assert.equal((await confirm(fixture, taskId)).status, 201);
      assert.equal(await statusOf(candidate.id), "outdated");
      assert.equal((await decide(fixture, taskId, "machine-non-conforme")).status, 201);
      const renewed = candidateOf(await attach(fixture, taskId, file.id));
      assert.notEqual(renewed.id, candidate.id);
      assert.equal(renewed.bindings.conformityOutcome, "machine-non-conforme");
      assert.deepEqual([await statusOf(renewed.id), await statusOf(candidate.id)], ["ready", "outdated"]);
      assert.equal(await reportCount(pool), "2/2");
    });
  });
});

test("P7 P8 the list holds Word and PDF candidates newest first, team-scoped; the PDF downloads as the exact bytes with the required headers", async () => {
  await withPdfReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const pdf = buildPdf({ version: "1.7" });
      const file = fileOf(await upload(fixture, taskId, pdf));
      const word = candidateOf(await call(fixture, "POST", `/tasks/${taskId}/report-candidates`, fixture.tokens.owner, { attemptId: randomUUID() }));
      const candidate = candidateOf(await attach(fixture, taskId, file.id));
      const listed = reportCandidateListSchema.parse((await list(fixture, taskId)).body).candidates;
      assert.deepEqual(listed.map((entry) => [entry.id, entry.origin, entry.source === null]), [[candidate.id, "uploaded-pdf", false], [word.id, "generated-word", true]]);
      assert.equal(listed[1]!.template!.id, "cetem-paper-report");
      assert.ok(listed.every((entry) => !("official" in entry) && !JSON.stringify(entry).includes("files/pdf/")));
      assert.equal((await list(fixture, taskId, fixture.tokens.otherOwner)).status, 404);

      const response = await downloadCandidate(fixture, taskId, candidate.id);
      assert.equal(response.status, 200);
      assert.ok(response.bytes.equals(pdf));
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.match(response.headers.get("content-disposition") ?? "", new RegExp(`^attachment; filename="Rapport-LCQ-candidat-\\d{8}-${candidate.id.replaceAll("-", "").slice(0, 8)}\\.pdf"$`));
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal((await downloadCandidate(fixture, taskId, word.id)).status, 200);
      for (const [label, id, token] of [["unknown", randomUUID(), undefined], ["malformed", "not-a-uuid", undefined], ["other team", candidate.id, fixture.tokens.otherOwner]] as const) {
        const reply = await downloadCandidate(fixture, taskId, id, token ?? fixture.tokens.owner);
        assert.deepEqual([reply.status, JSON.parse(reply.bytes.toString("utf8"))], [404, NOT_FOUND], label);
      }
      assert.equal((await downloadCandidate(fixture, taskId, candidate.id, fixture.tokens.employee)).status, 403);
    });
  });
});

test("P9 attaching writes nothing outside the two report tables and calls neither the scanner nor the storage", async () => {
  await withPdfReports(async ({ scanner, calls }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const file = fileOf(await upload(fixture, taskId));
      const before = await fingerprint(pool, untouchedTables);
      const scans = scanner.calls;
      const storageCalls = { ...calls };
      assert.equal((await attach(fixture, taskId, file.id)).status, 201);
      assert.equal((await list(fixture, taskId)).status, 200);
      assert.equal(await fingerprint(pool, untouchedTables), before);
      assert.equal(scanner.calls, scans);
      assert.deepEqual(calls, storageCalls);
    });
  });
});

test("P10 the report tables stay insert-only and PostgreSQL checks the PDF shape", async () => {
  await withPdfReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const file = fileOf(await upload(fixture, taskId));
      const candidate = candidateOf(await attach(fixture, taskId, file.id));
      for (const statement of ["UPDATE report_candidates SET origin = origin", "DELETE FROM report_candidates", "TRUNCATE report_candidates",
        "UPDATE report_candidate_outcomes SET byte_size = 1", "DELETE FROM report_candidate_outcomes", "TRUNCATE report_candidate_outcomes"]) {
        await assert.rejects(pool.query(statement), (error: Error) => { assert.ok(error.message.length > 0); return true; }, statement);
      }
      const insert = (origin: string, storedFileId: string | null, templateId: string | null) => pool.query<{ id: string }>(
        `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version, conformity_decision_id, origin, stored_file_id, template_id, template_version, requested_by)
         SELECT $1, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version, conformity_decision_id, $2, $3, $4, $5, requested_by FROM report_candidates WHERE id = $6 RETURNING id`,
        [randomUUID(), origin, storedFileId, templateId, templateId ? "1.0.0" : null, candidate.id]);
      await assert.rejects(insert("uploaded-pdf", null, null), /check/i, "uploaded-pdf without a file");
      await assert.rejects(insert("generated-word", file.id, "cetem-paper-report"), /check/i, "generated-word with a file");
      await assert.rejects(insert("uploaded-pdf", file.id, "cetem-paper-report"), /check/i, "uploaded-pdf with a template");
      await assert.rejects(insert("uploaded-pdf", file.id, null), /unique|duplicate/i, "duplicate file and bindings");
      await assert.rejects(insert("other", file.id, null), /check/i, "unknown origin");
      const word = (await insert("generated-word", null, "cetem-paper-report")).rows[0]!.id;
      await assert.rejects(pool.query("INSERT INTO report_candidate_outcomes (candidate_id, outcome) VALUES ($1, 'ready')", [word]), /check/i, "ready without a file name");
    });
  });
});

test("P11 logs carry only the event, the actor and a fixed class: no task, file or candidate ID, name or path", async () => {
  await withPdfReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { owner } = fixture;
      const { taskId } = await readyTask(fixture);
      const file = fileOf(await upload(fixture, taskId));
      const bad = fileOf(await upload(fixture, taskId, Buffer.from("not a pdf")));
      const unconfirmed = await readyTask(fixture);
      const unconfirmedFile = fileOf(await upload(fixture, unconfirmed.taskId));
      assert.equal((await reopen(fixture, unconfirmed.taskId)).status, 201);
      let candidate: ReportCandidate | undefined;
      const { lines } = await captureInfo(async () => {
        const attemptId = randomUUID();
        candidate = candidateOf(await attach(fixture, taskId, file.id, attemptId));
        await attach(fixture, taskId, file.id, attemptId);
        await attach(fixture, taskId, file.id);
        await attach(fixture, taskId, bad.id);
        await attach(fixture, taskId, file.id, randomUUID(), fixture.tokens.employee);
        await attach(fixture, randomUUID(), file.id);
        await attach(fixture, unconfirmed.taskId, unconfirmedFile.id);
        await downloadCandidate(fixture, taskId, candidate.id);
      });
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => String(line.event).startsWith("report.candidate."));
      assert.ok(parsed.some((line) => line.event === "report.candidate.attached"));
      for (const line of parsed) {
        assert.ok(Object.keys(line).every((key) => ["event", "actorId", "class"].includes(key)), JSON.stringify(line));
        assert.ok(line.actorId === owner || line.actorId === fixture.employee);
      }
      const classes = new Set(parsed.filter((line) => line.event === "report.candidate.refused").map((line) => line.class));
      for (const expected of ["already-attached", "file-not-ready", "forbidden-role", "not-found", "not-confirmed"]) assert.ok(classes.has(expected), expected);
      const everything = lines.join("\n");
      for (const secret of [taskId, file.id, bad.id, candidate!.id, candidate!.attemptId, "Rapport signé", "files/pdf/"]) assert.ok(!everything.includes(secret), secret);
    });
  });
});

test("P12 migration 0024 applies on top of 0023 data without rewriting rows; an existing Word row stays valid and lists with source null", async () => {
  await withPdfReports(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId, submissionId, summary, decision } = await readyTask(fixture);
      assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'report_candidates' AND column_name = 'stored_file_id'")).rows.length, 0, "0024 is not applied yet");
      const audit = (await pool.query<{ audit_id: string }>("SELECT audit_id FROM audit_submissions WHERE id = $1", [submissionId])).rows[0]!;
      const word = await pool.query<{ id: string }>(
        `INSERT INTO report_candidates (attempt_id, task_id, audit_id, submission_id, audit_revision, confirmed_summary_id, summary_version, conformity_decision_id, origin, template_id, template_version, requested_by)
         VALUES ($1, $2, $3, $4, 1, $5, 1, $6, 'generated-word', 'cetem-paper-report', '1.0.0', $7) RETURNING id`,
        [randomUUID(), taskId, audit.audit_id, submissionId, summary.id, decision.id, fixture.owner]);
      await pool.query("INSERT INTO report_candidate_outcomes (candidate_id, outcome, storage_ref, file_name, byte_size, sha256) VALUES ($1, 'ready', 'reports/x.docx', 'x.docx', 1, repeat('a', 64))", [word.rows[0]!.id]);
      const before = await fingerprint(pool, [...untouchedTables, "report_candidate_outcomes"]);
      await migrate(pool);
      assert.equal((await pool.query("SELECT version FROM schema_migrations WHERE version LIKE '0024%'")).rows.length, 1);
      assert.equal(await fingerprint(pool, [...untouchedTables, "report_candidate_outcomes"]), before);
      const migrated = (await candidateRows(pool))[0]!;
      assert.deepEqual([migrated.origin, migrated.stored_file_id, migrated.template_id], ["generated-word", null, "cetem-paper-report"]);
      const reply = await list(fixture, taskId);
      const listed = reportCandidateListSchema.parse(reply.body).candidates;
      assert.deepEqual(listed.map((entry) => [entry.origin, entry.source]), [["generated-word", null]]);
    }, { migrateThrough: "0023_stored_files" });
  });
});

test("U1 files exports the derived status and the scan notes through the single derivation", async () => {
  await withPdfReports(async ({ scanner }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const ready = fileOf(await upload(fixture, taskId));
      scanner.next = "unavailable";
      const failed = fileOf(await upload(fixture, taskId));
      assert.equal(await getStoredFileStatus(pool, { taskId, fileId: ready.id }), "ready");
      assert.equal(await getStoredFileStatus(pool, { taskId, fileId: failed.id }), "scan-failed");
      assert.equal(await getStoredFileStatus(pool, { taskId, fileId: randomUUID() }), undefined);
      assert.equal(await getStoredFileStatus(pool, { taskId: randomUUID(), fileId: ready.id }), undefined);
      const results = await getFileScanResults(pool, [ready.id, failed.id, randomUUID()]);
      assert.deepEqual([results.get(ready.id), results.get(failed.id), results.size], ["clean", null, 2]);
      assert.equal((await getFileScanResults(pool, [])).size, 0);
    });
  });
});
