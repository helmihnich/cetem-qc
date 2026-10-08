import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  confirmedSummarySchema, conformityDecisionSchema, deactivatedAssigneeRecoveryResponseSchema, historyListResponseSchema, historyRecordResponseSchema,
  officialReportSchema, replacementTaskResponseSchema, reportCandidateSchema, storedFileSchema, taskListResponseSchema,
} from "@cetem-qc/schemas/api/v1";
import type { HistoryListItem, HistoryRecordResponse, OfficialReport, ReportCandidate } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { getAuthorizedTaskSummary, listAuthorizedTaskIds } from "./modules/tasks/queries/authorized-task.js";
import { reviewCommandTestSeams } from "./modules/audits/commands/record-review-access.js";
import { createMemoryObjectStorage, createPdfScanner, fileCommandTestSeams } from "./modules/files/index.js";
import { createWordTemplateGenerator, reportCommandTestSeams } from "./modules/reports/index.js";
import { summaryReopenParticipantTestSeams } from "./modules/summaries/index.js";
import { registerDefaultSummaryReopenParticipants } from "./register-participants.js";
import { buildPdf } from "./test-support/pdf-fixtures.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 11.5: read-only completed history for both roles (synthetic names, in-memory storage, scanner none; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const NOT_READY = { error: { code: "REPORT_FILE_NOT_READY", message: "Le fichier du rapport officiel n’est pas disponible." } };
const DOWNLOAD_FAILED = { error: { code: "INTERNAL_ERROR", message: "Le rapport n’a pas pu être téléchargé." } };
const RECORD_FAILED = { error: { code: "INTERNAL_ERROR", message: "Le contrôle terminé n’a pas pu être chargé." } };
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
async function download(fixture: SyncFixture, path: string, token: string | null) {
  const response = await fetch(`${fixture.apiRoot}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes, headers: response.headers, json: () => JSON.parse(bytes.toString("utf8")) as Record<string, unknown> };
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

const owner = (fixture: SyncFixture) => fixture.tokens.owner;
const listHistory = (fixture: SyncFixture, token: string | null, query = "") => call(fixture, "GET", `/history${query}`, token);
const record = (fixture: SyncFixture, taskId: string, token: string | null) => call(fixture, "GET", `/history/${taskId}`, token);
const file = (fixture: SyncFixture, taskId: string, token: string | null) => download(fixture, `/history/${taskId}/official-report/file`, token);
const records = (reply: Reply): HistoryListItem[] => historyListResponseSchema.parse(reply.body).records;
const recordOf = (reply: Reply): HistoryRecordResponse => historyRecordResponseSchema.parse(reply.body);

const generate = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/report-candidates`, owner(fixture), { attemptId: randomUUID() });
const designate = (fixture: SyncFixture, taskId: string, candidateId: string) => call(fixture, "POST", `/tasks/${taskId}/report-candidates/${candidateId}/designate`, owner(fixture), {});
const candidateOf = (reply: Reply): ReportCandidate => reportCandidateSchema.parse(reply.body);

async function accept(fixture: SyncFixture, assignee = fixture.employee, token = fixture.tokens.employee, values: Record<string, string> = { "header.reportNumber": "R-115" }, taskId?: string) {
  const id = taskId ?? await fixture.newTask(assignee);
  const reply = await fixture.send("submissions", id, envelope(0, formPayload(values)), token);
  assert.equal(reply.status, 200, reply.text);
  return id;
}
async function decideTask(fixture: SyncFixture, taskId: string, outcome = "machine-conforme") {
  const summary = confirmedSummarySchema.parse((await call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, owner(fixture), { text: "Synthèse finale." })).body);
  const decision = conformityDecisionSchema.parse((await call(fixture, "POST", `/tasks/${taskId}/conformity-decision`, owner(fixture), { outcome })).body);
  return { summary, decision };
}
/** Accepted, confirmed, decided, Word generated and designated official. */
async function completeWord(fixture: SyncFixture, options: { assignee?: string; token?: string; outcome?: string; taskId?: string } = {}) {
  const taskId = await accept(fixture, options.assignee, options.token, undefined, options.taskId);
  const bound = await decideTask(fixture, taskId, options.outcome);
  const candidate = candidateOf(await generate(fixture, taskId));
  const reply = await designate(fixture, taskId, candidate.id);
  assert.equal(reply.status, 201, reply.text);
  return { taskId, ...bound, candidate, official: officialReportSchema.parse(reply.body) as OfficialReport };
}
async function completePdf(fixture: SyncFixture) {
  const taskId = await accept(fixture);
  await decideTask(fixture, taskId);
  const stored = storedFileSchema.parse((await upload(fixture, taskId)).body);
  const candidate = candidateOf(await call(fixture, "POST", `/tasks/${taskId}/pdf-files/${stored.id}/report-candidate`, owner(fixture), { attemptId: randomUUID() }));
  const reply = await designate(fixture, taskId, candidate.id);
  assert.equal(reply.status, 201, reply.text);
  return { taskId, stored, candidate, official: officialReportSchema.parse(reply.body) as OfficialReport };
}

async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const allTables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "audit_insight_decisions", "audit_manual_insights",
  "audit_review_accesses", "audit_replacement_links", "summary_ai_drafts", "confirmed_summaries", "summary_reopenings", "conformity_decisions", "conformity_decision_invalidations",
  "stored_files", "stored_file_checks", "report_candidates", "report_candidate_outcomes", "official_reports"];

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

async function withHistory<T>(run: (context: { storage: ReturnType<typeof createMemoryObjectStorage>; calls: { put: number } }) => Promise<T>): Promise<T> {
  const inner = createMemoryObjectStorage();
  const calls = { put: 0 };
  const storage = Object.assign(Object.create(inner) as typeof inner, {
    put: async (key: string, bytes: Uint8Array) => { calls.put++; await inner.put(key, bytes); },
  });
  const word = createWordTemplateGenerator();
  fileCommandTestSeams.storage = storage;
  fileCommandTestSeams.scanner = createPdfScanner({});
  reportCommandTestSeams.storage = storage;
  reportCommandTestSeams.generator = word;
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

test("H1 both roles list the completed controls they may see, newest designation first, and nothing else", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const { tokens, colleague, otherEmployee, otherOwner } = fixture;
      assert.deepEqual((await listHistory(fixture, owner(fixture))).body, { records: [] }, "empty history");
      assert.deepEqual((await listHistory(fixture, tokens.employee)).body, { records: [] });
      const first = await completeWord(fixture);
      const second = await completeWord(fixture, { outcome: "machine-non-conforme" });
      const colleagueTask = await completeWord(fixture, { assignee: colleague, token: tokens.colleague });
      await accept(fixture); // accepted, no official report
      await fixture.newTask(fixture.employee); // draft
      const foreignTask = await accept(fixture, otherEmployee, tokens.otherEmployee, undefined, await fixture.newTask(otherEmployee, otherOwner));
      assert.ok(foreignTask);
      const reply = await listHistory(fixture, owner(fixture));
      assert.equal(reply.status, 200);
      assert.match(reply.cacheControl ?? "", /no-store/i);
      const items = records(reply);
      assert.deepEqual(items.map((item) => item.taskId), [colleagueTask.taskId, second.taskId, first.taskId], "newest designation first");
      const item = items.find((candidate) => candidate.taskId === second.taskId)!;
      assert.deepEqual(item, {
        taskId: second.taskId, type: "graphie_mobile", establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test",
        auditId: second.official.auditId, auditRevision: 1, acceptedAt: item.acceptedAt, designatedAt: second.official.designatedAt,
        conformityOutcome: "machine-non-conforme", reportOrigin: "generated-word", lineage: [],
      });
      const mine = records(await listHistory(fixture, tokens.employee));
      assert.deepEqual(mine.map((entry) => entry.taskId), [second.taskId, first.taskId], "Employé: only their own current assignments");
      assert.deepEqual(records(await listHistory(fixture, tokens.colleague)).map((entry) => entry.taskId), [colleagueTask.taskId]);
      assert.deepEqual(records(await listHistory(fixture, tokens.otherOwner)), [], "another team sees nothing");
      assert.deepEqual(records(await listHistory(fixture, tokens.otherEmployee)), []);
    });
  });
});

test("H2 the completed record carries the stored evidence, decisions, summary, conformity and official report for both roles", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId, summary, decision, official } = await completeWord(fixture);
      const asOwner = await record(fixture, taskId, owner(fixture));
      assert.equal(asOwner.status, 200, asOwner.text);
      assert.match(asOwner.cacheControl ?? "", /no-store/i);
      const body = recordOf(asOwner);
      const stored = (await fixture.pool.query<{ payload: { values: Record<string, string> }; results: unknown }>(
        "SELECT revision.payload, revision.results FROM audits audit JOIN audit_revisions revision ON revision.audit_id = audit.id AND revision.revision = audit.current_revision WHERE audit.task_id = $1", [taskId])).rows[0]!;
      assert.deepEqual(body.values, stored.payload.values);
      assert.deepEqual(body.results, stored.results);
      assert.equal(body.values["header.reportNumber"], "R-115");
      assert.deepEqual(body.summary.id, summary.id);
      assert.deepEqual(body.summaryVersion, { number: 1, state: "confirmed" });
      assert.deepEqual(body.summaryHistory, []);
      assert.equal(body.conformityDecision.id, decision.id);
      assert.deepEqual(body.conformityHistory, []);
      assert.deepEqual(body.officialReport, official);
      assert.deepEqual(body.lineage, []);
      assert.deepEqual(body.task, { id: taskId, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" });
      assert.equal(body.submission.auditId, official.auditId);
      assert.ok(Array.isArray(body.insightDecisions) && Array.isArray(body.manualInsights));
      const asEmployee = await record(fixture, taskId, fixture.tokens.employee);
      assert.equal(asEmployee.status, 200);
      assert.equal(asEmployee.text, asOwner.text, "same content for both roles");
    });
  });
});

test("H2b stored insight decisions, manual insights and conformity history are part of the record", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const taskId = await accept(fixture);
      const evidence = (await call(fixture, "GET", `/tasks/${taskId}/accepted-evidence`, owner(fixture))).body as { insights: { proposals: Array<{ id: string }> } };
      const proposal = evidence.insights.proposals[0];
      if (proposal) assert.equal((await call(fixture, "POST", `/tasks/${taskId}/insight-decisions`, owner(fixture), { proposalId: proposal.id, decision: "retained" })).status, 200);
      const manual = await call(fixture, "POST", `/tasks/${taskId}/manual-insights`, owner(fixture), { text: "Observation manuelle.", justification: "Constat sur site." });
      assert.equal(manual.status, 201, manual.text);
      await decideTask(fixture, taskId);
      assert.equal((await call(fixture, "POST", `/tasks/${taskId}/summary-reopening`, owner(fixture), {})).status, 201);
      await decideTask(fixture, taskId, "machine-non-conforme");
      const candidate = candidateOf(await generate(fixture, taskId));
      assert.equal((await designate(fixture, taskId, candidate.id)).status, 201);
      const body = recordOf(await record(fixture, taskId, owner(fixture)));
      assert.equal(body.manualInsights.length, 1);
      if (proposal) assert.equal(body.insightDecisions.length, 1);
      assert.deepEqual(body.summaryVersion, { number: 2, state: "confirmed" });
      assert.equal(body.summaryHistory.length, 1);
      assert.equal(body.conformityDecision.outcome, "machine-non-conforme");
      assert.equal(body.conformityHistory.length, 1, "the earlier decision stays in the history");
      assert.equal(body.officialReport.bindings.conformityOutcome, "machine-non-conforme");
    });
  });
});

test("H3 an uploaded-PDF control shows its origin, source file and no template", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId, stored, official } = await completePdf(fixture);
      const body = recordOf(await record(fixture, taskId, fixture.tokens.employee));
      assert.equal(body.officialReport.origin, "uploaded-pdf");
      assert.deepEqual([body.officialReport.source, body.officialReport.template], [{ fileId: stored.id }, null]);
      assert.deepEqual(body.officialReport, official);
      assert.equal(records(await listHistory(fixture, owner(fixture)))[0]!.reportOrigin, "uploaded-pdf");
    });
  });
});

test("H4 the download serves exactly the official bytes with safe headers and never another candidate's", async () => {
  await withHistory(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const taskId = await accept(fixture);
      await decideTask(fixture, taskId);
      const superseded = candidateOf(await generate(fixture, taskId));
      const stored = storedFileSchema.parse((await upload(fixture, taskId)).body);
      const pdfCandidate = candidateOf(await call(fixture, "POST", `/tasks/${taskId}/pdf-files/${stored.id}/report-candidate`, owner(fixture), { attemptId: randomUUID() }));
      const chosen = candidateOf(await generate(fixture, taskId));
      const official = officialReportSchema.parse((await designate(fixture, taskId, chosen.id)).body);
      assert.notEqual(superseded.id, chosen.id);
      const expected = await download(fixture, `/tasks/${taskId}/report-candidates/${chosen.id}/file`, owner(fixture));
      for (const token of [owner(fixture), fixture.tokens.employee]) {
        const served = await file(fixture, taskId, token);
        assert.equal(served.status, 200);
        assert.equal(served.headers.get("content-type"), DOCX);
        assert.match(served.headers.get("content-disposition") ?? "", /^attachment; filename="/);
        assert.equal(served.headers.get("content-length"), String(served.bytes.length));
        assert.equal(served.headers.get("x-content-type-options"), "nosniff");
        assert.match(served.headers.get("cache-control") ?? "", /no-store/i);
        assert.deepEqual(served.bytes, expected.bytes);
        assert.equal(createHash("sha256").update(served.bytes).digest("hex"), official.file.sha256);
        assert.equal(served.bytes.length, official.file.byteSize);
      }
      assert.ok(pdfCandidate.id && storage);
    });
  });
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const { taskId, official } = await completePdf(fixture);
      const served = await file(fixture, taskId, fixture.tokens.employee);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "application/pdf");
      assert.match(served.headers.get("content-disposition") ?? "", /^attachment; filename="Rapport-LCQ-officiel-\d{8}-[0-9a-f]{8}\.pdf"$/);
      assert.deepEqual(served.bytes, Buffer.from(buildPdf()));
      assert.equal(createHash("sha256").update(served.bytes).digest("hex"), official.file.sha256);
      assert.ok(!(await download(fixture, `/history/${taskId}/official-report/file?candidateId=${randomUUID()}`, owner(fixture))).bytes.includes("storageRef"));
    });
  });
});

test("H5 the download fails closed: a PDF no longer ready is 409, missing or altered Word bytes are 500, no bytes either way", async () => {
  await withHistory(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const pdf = await completePdf(fixture);
      await fixture.pool.query("INSERT INTO stored_file_checks (file_id, stage, result, scanner) VALUES ($1, 'scan', 'threat', 'clamav')", [pdf.stored.id]);
      const blocked = await captureInfo(() => file(fixture, pdf.taskId, owner(fixture)));
      assert.equal(blocked.result.status, 409);
      assert.deepEqual(blocked.result.json(), NOT_READY);
      assert.ok(!blocked.result.bytes.includes("%PDF"));
      assert.deepEqual(blocked.lines.map((line) => JSON.parse(line)), [{ event: "history.refused", class: "file-not-ready", actorId: fixture.owner }]);

      const word = await completeWord(fixture);
      const ref = (await fixture.pool.query<{ storage_ref: string }>("SELECT storage_ref FROM report_candidate_outcomes WHERE candidate_id = $1", [word.candidate.id])).rows[0]!.storage_ref;
      const original = (await storage.get(ref))!;
      await storage.put(ref, new Uint8Array([...original.slice(0, original.length - 1), original[original.length - 1]! ^ 1]));
      const altered = await captureInfo(() => file(fixture, word.taskId, owner(fixture)));
      assert.equal(altered.result.status, 500);
      assert.deepEqual(altered.result.json(), DOWNLOAD_FAILED);
      assert.deepEqual(altered.lines.map((line) => JSON.parse(line)), [{ event: "history.refused", class: "inconsistent", actorId: fixture.owner }]);
      await storage.remove(ref);
      const missing = await file(fixture, word.taskId, fixture.tokens.employee);
      assert.deepEqual([missing.status, missing.json()], [500, DOWNLOAD_FAILED]);
      await storage.put(ref, original);
      assert.equal((await file(fixture, word.taskId, owner(fixture))).status, 200);
    });
  });
});

test("H6 every non-authorized case is the same 404 on all three routes; unauthenticated is 401; a query string on the list is 400", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const { tokens, colleague, otherEmployee, otherOwner, pool } = fixture;
      const completed = await completeWord(fixture);
      const reassigned = await completeWord(fixture);
      await pool.query("UPDATE task_assignments SET employee_id = $1 WHERE task_id = $2", [colleague, reassigned.taskId]);
      const acceptedOnly = await accept(fixture);
      const draft = await fixture.newTask(fixture.employee);
      const foreign = await accept(fixture, otherEmployee, tokens.otherEmployee, undefined, await fixture.newTask(otherEmployee, otherOwner));
      const reference = (await call(fixture, "GET", `/tasks/${randomUUID()}/accepted-evidence`, owner(fixture))).text;
      assert.deepEqual(JSON.parse(reference), NOT_FOUND);
      const cases: Array<[string, string, string]> = [
        ["malformed", "not-a-uuid", owner(fixture)],
        ["unknown", randomUUID(), owner(fixture)],
        ["other team (Responsable)", completed.taskId, tokens.otherOwner],
        ["other Employé", completed.taskId, tokens.colleague],
        ["other team Employé", completed.taskId, tokens.otherEmployee],
        ["reassigned away", reassigned.taskId, tokens.employee],
        ["draft (Responsable)", draft, owner(fixture)],
        ["draft (Employé)", draft, tokens.employee],
        ["accepted without official (Responsable)", acceptedOnly, owner(fixture)],
        ["accepted without official (Employé)", acceptedOnly, tokens.employee],
      ];
      cases.push(["other team accepted task (first team)", foreign, owner(fixture)]);
      for (const [label, taskId, token] of cases) {
        const viaRecord = await record(fixture, taskId, token);
        const viaFile = await file(fixture, taskId, token);
        assert.equal(viaRecord.status, 404, label);
        assert.equal(viaRecord.text, reference, label);
        assert.equal(viaFile.status, 404, label);
        assert.equal(Buffer.from(viaFile.bytes).toString("utf8"), reference, label);
      }
      assert.equal((await record(fixture, reassigned.taskId, tokens.colleague)).status, 200, "the current assignee sees it");
      for (const [label, taskId] of [["list", ""], ["record", `/${completed.taskId}`], ["file", `/${completed.taskId}/official-report/file`]] as const) {
        const response = await fetch(`${fixture.apiRoot}/history${taskId}`);
        assert.equal(response.status, 401, label);
      }
      const query = await listHistory(fixture, owner(fixture), "?x=1");
      assert.deepEqual([query.status, (query.body.error as { code: string }).code], [400, "VALIDATION_ERROR"]);
      assert.ok(!records(await listHistory(fixture, tokens.employee)).some((item) => item.taskId === reassigned.taskId));
      assert.ok(!records(await listHistory(fixture, owner(fixture))).some((item) => [acceptedOnly, draft].includes(item.taskId)));
    });
  });
});

test("H7 replacement lineage shows ids only to a viewer authorized for the other task and changes nothing", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const { colleague, tokens, pool } = fixture;
      const original = await completeWord(fixture);
      const before = JSON.stringify(recordOf(await record(fixture, original.taskId, owner(fixture))));
      const auditsBefore = await fingerprint(pool, ["tasks", "audits", "audit_revisions", "audit_submissions", "official_reports", "report_candidates"]);
      const replacement = replacementTaskResponseSchema.parse((await call(fixture, "POST", `/tasks/${original.taskId}/replacements`, owner(fixture),
        { establishment: "Établissement Remplacement", service: "Radiologie", type: "graphie_mobile", assigneeId: colleague })).body);
      const replacementId = replacement.task.id;
      const pending = recordOf(await record(fixture, original.taskId, owner(fixture)));
      assert.deepEqual(pending.lineage, [{ relation: "replaced-by", accessible: true, taskId: replacementId, auditId: null, completed: false }]);
      assert.equal(JSON.stringify({ ...pending, lineage: [] }), JSON.stringify({ ...JSON.parse(before), lineage: [] }), "original unchanged");

      const done = await completeWord(fixture, { assignee: colleague, token: tokens.colleague, taskId: replacementId });
      const afterOriginal = recordOf(await record(fixture, original.taskId, owner(fixture)));
      assert.deepEqual(afterOriginal.lineage, [{ relation: "replaced-by", accessible: true, taskId: replacementId, auditId: done.official.auditId, completed: true }]);
      assert.deepEqual(afterOriginal.officialReport, original.official);
      assert.equal(JSON.stringify({ ...afterOriginal, lineage: [] }), JSON.stringify({ ...JSON.parse(before), lineage: [] }));
      assert.deepEqual(recordOf(await record(fixture, replacementId, owner(fixture))).lineage,
        [{ relation: "replacement-of", accessible: true, taskId: original.taskId, auditId: original.official.auditId, completed: true }]);
      // The original Employé is not assigned to the replacement.
      assert.deepEqual(recordOf(await record(fixture, original.taskId, tokens.employee)).lineage, [{ relation: "replaced-by", accessible: false, taskId: null, auditId: null, completed: null }]);
      const listed = records(await listHistory(fixture, tokens.employee)).find((item) => item.taskId === original.taskId)!;
      assert.deepEqual(listed.lineage, [{ relation: "replaced-by", accessible: false, taskId: null, auditId: null, completed: null }]);
      assert.ok(!(await record(fixture, original.taskId, tokens.employee)).text.includes(replacementId));
      assert.ok(auditsBefore.length > 0);
      const rowsOfOriginal = await fingerprint(pool, ["audit_revisions", "audit_submissions", "official_reports"]);
      assert.ok(rowsOfOriginal.includes(original.taskId));
    });
  });
});

test("H7b recovery source and successor follow the same visibility rule", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool, employee, colleague, tokens } = fixture;
      const sourceTaskId = await fixture.newTask(employee);
      assert.equal((await fixture.send("draft-syncs", sourceTaskId, envelope(0, formPayload({ "header.reportNumber": "R-84" })))).status, 200);
      await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
      const source = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", owner(fixture))).body).tasks.find((task) => task.id === sourceTaskId)!;
      const recovered = deactivatedAssigneeRecoveryResponseSchema.parse((await call(fixture, "POST", `/tasks/${sourceTaskId}/deactivated-assignee-recovery`, owner(fixture),
        { successorId: colleague, expectedAssignmentVersion: source.assignmentVersion, sourceRevision: 1 })).body);
      const successorId = recovered.task.id;
      const successorSubmit = await fixture.send("submissions", successorId, envelope(1, formPayload({ "header.reportNumber": "R-84" })), tokens.colleague);
      assert.equal(successorSubmit.status, 200, successorSubmit.text);
      await decideTask(fixture, successorId);
      const candidate = candidateOf(await generate(fixture, successorId));
      assert.equal((await designate(fixture, successorId, candidate.id)).status, 201);
      const asOwner = recordOf(await record(fixture, successorId, owner(fixture)));
      assert.deepEqual(asOwner.lineage, [{ relation: "recovery-source", accessible: true, taskId: sourceTaskId, auditId: recovered.source.auditId, completed: false }]);
      const asColleague = recordOf(await record(fixture, successorId, tokens.colleague));
      assert.deepEqual(asColleague.lineage, [{ relation: "recovery-source", accessible: false, taskId: null, auditId: null, completed: null }]);
    });
  });
});

test("H8 history reads write nothing: no row, no updated_at, no review access, no storage write", async () => {
  await withHistory(async ({ calls }) => {
    await withSyncFixture(async (fixture) => {
      const { pool, tokens } = fixture;
      const word = await completeWord(fixture);
      const pdf = await completePdf(fixture);
      const before = await fingerprint(pool, allTables);
      const puts = calls.put;
      for (const token of [owner(fixture), tokens.employee, tokens.otherOwner, tokens.colleague]) {
        for (let round = 0; round < 2; round++) {
          await listHistory(fixture, token);
          for (const taskId of [word.taskId, pdf.taskId]) {
            await record(fixture, taskId, token);
            await file(fixture, taskId, token);
          }
        }
      }
      assert.equal(await fingerprint(pool, allTables), before);
      assert.equal(calls.put, puts);
      // W4 is unchanged: it still writes its own access row.
      const accesses = Number((await pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_review_accesses")).rows[0]!.n);
      assert.equal((await call(fixture, "GET", `/tasks/${word.taskId}/accepted-evidence`, owner(fixture))).status, 200);
      assert.equal(Number((await pool.query<{ n: string }>("SELECT count(*) AS n FROM audit_review_accesses")).rows[0]!.n), accesses + 1);
    });
  });
});

test("H9 an inconsistent snapshot gives 500 without data on the record only; list and download keep working", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const bad = await completeWord(fixture);
      const good = await completeWord(fixture);
      reviewCommandTestSeams.snapshot = (snapshot) => snapshot.taskId === bad.taskId ? { ...snapshot, identity: { ...snapshot.identity, ruleVersion: "9.9.9" } } : snapshot;
      const reply = await captureInfo(() => record(fixture, bad.taskId, owner(fixture)));
      assert.deepEqual([reply.result.status, reply.result.body], [500, RECORD_FAILED]);
      assert.ok(!reply.result.text.includes("R-115"));
      assert.deepEqual(reply.lines.map((line) => JSON.parse(line)), [{ event: "history.refused", class: "inconsistent", actorId: fixture.owner }]);
      assert.equal((await record(fixture, good.taskId, owner(fixture))).status, 200);
      assert.equal(records(await listHistory(fixture, owner(fixture))).length, 2);
      assert.equal((await file(fixture, bad.taskId, owner(fixture))).status, 200);
    });
  });
});

test("H10 logs carry the event, the actor and a fixed class only", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const word = await completeWord(fixture);
      const { lines } = await captureInfo(async () => {
        await listHistory(fixture, owner(fixture));
        await record(fixture, word.taskId, fixture.tokens.employee);
        await file(fixture, word.taskId, owner(fixture));
        await record(fixture, randomUUID(), fixture.tokens.employee);
        await file(fixture, "not-a-uuid", owner(fixture));
      });
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.deepEqual(parsed, [
        { event: "history.list.opened", actorId: fixture.owner },
        { event: "history.record.opened", actorId: fixture.employee },
        { event: "history.report.downloaded", actorId: fixture.owner },
        { event: "history.refused", class: "not-found", actorId: fixture.employee },
        { event: "history.refused", class: "not-found", actorId: fixture.owner },
      ]);
      const text = lines.join("\n");
      for (const secret of [word.taskId, word.official.auditId, word.official.file.name, "Établissement", "reports/"]) assert.ok(!text.includes(secret), secret);
    });
  });
});

test("H11 the candidate download route still serves candidates and keeps its own logging", async () => {
  await withHistory(async () => {
    await withSyncFixture(async (fixture) => {
      const word = await completeWord(fixture);
      const served = await download(fixture, `/tasks/${word.taskId}/report-candidates/${word.candidate.id}/file`, owner(fixture));
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), DOCX);
      assert.equal((await download(fixture, `/tasks/${word.taskId}/report-candidates/${word.candidate.id}/file`, fixture.tokens.employee)).status, 403);
    });
  });
});

test("U1 authorization predicates per role: team for the Responsable, current assignment for the Employé, Inactif assignee, malformed id", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner: ownerId, employee, colleague, otherOwner, otherEmployee } = fixture;
    const mine = await fixture.newTask(employee);
    const teammates = await fixture.newTask(colleague);
    const foreign = await fixture.newTask(otherEmployee, otherOwner);
    assert.deepEqual((await listAuthorizedTaskIds(pool, { id: ownerId, role: "responsable" })).sort(), [mine, teammates].sort());
    assert.deepEqual(await listAuthorizedTaskIds(pool, { id: employee, role: "employe" }), [mine]);
    assert.deepEqual(await listAuthorizedTaskIds(pool, { id: otherOwner, role: "responsable" }), [foreign]);
    assert.deepEqual(await getAuthorizedTaskSummary(pool, { id: employee, role: "employe" }, mine), { id: mine, type: "graphie_mobile", establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" });
    assert.equal(await getAuthorizedTaskSummary(pool, { id: employee, role: "employe" }, teammates), undefined);
    assert.equal(await getAuthorizedTaskSummary(pool, { id: ownerId, role: "responsable" }, foreign), undefined);
    assert.equal(await getAuthorizedTaskSummary(pool, { id: ownerId, role: "responsable" }, "not-a-uuid"), undefined);
    assert.equal(await getAuthorizedTaskSummary(pool, { id: employee, role: "responsable" }, mine), undefined, "a role is never inferred from the id");
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
    assert.equal((await getAuthorizedTaskSummary(pool, { id: ownerId, role: "responsable" }, mine))!.assignee, "Employé Test — Inactif");
  });
});
