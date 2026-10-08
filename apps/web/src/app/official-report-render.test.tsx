import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OfficialReport, ReportCandidate } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { designateReportCandidateOnServer, loadOfficialReport, ReportCandidatesSection } from "./report-candidates";
import { PdfFilesSection } from "./pdf-files";
import { POST as DESIGNATE } from "./api/tasks/[taskId]/report-candidates/[candidateId]/designate/route";
import { GET as OFFICIAL } from "./api/tasks/[taskId]/official-report/route";

// Story 11.4 (W1–W5): designation in the W5 report area. Synthetic names only.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const TASK = "00000000-0000-4000-8000-000000000601";
const ID = "00000000-0000-4000-8000-000000000602";
const OTHER = "00000000-0000-4000-8000-000000000605";
const USER = "00000000-0000-4000-8000-000000000603";
const ATTEMPT = "00000000-0000-4000-8000-000000000604";
const decode = (markup: string) => markup.replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", "\"").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((match) => ({ attrs: match[1]!, label: match[2]! }));
const candidate = (overrides: Partial<ReportCandidate> = {}): ReportCandidate => ({
  id: ID, attemptId: ATTEMPT, origin: "generated-word", status: "ready", requestedAt: "2026-10-08T12:00:00.000Z",
  requestedBy: { id: USER, displayName: "Responsable Test" },
  bindings: { auditRevision: 1, summaryId: ID, summaryVersion: 2, conformityDecisionId: ID, conformityOutcome: "machine-conforme" },
  template: { id: "cetem-paper-report", version: "1.0.0" }, source: null,
  file: { name: "Rapport-LCQ-candidat-20261008-00000000.docx", byteSize: 1234, sha256: "a".repeat(64) },
  failureClass: null, ...overrides,
});
const officialReport = (overrides: Partial<OfficialReport> = {}): OfficialReport => ({
  id: ID, candidateId: ID, origin: "generated-word", designatedAt: "2026-10-08T13:00:00.000Z", designatedBy: { id: USER, displayName: "Responsable Test" },
  taskId: TASK, auditId: ID, auditRevision: 1, submissionId: ID,
  bindings: { summaryId: ID, summaryVersion: 2, conformityDecisionId: ID, conformityOutcome: "machine-conforme" },
  template: { id: "cetem-paper-report", version: "1.0.0" }, source: null,
  file: { name: "Rapport-LCQ-candidat-20261008-00000000.docx", byteSize: 1234, sha256: "a".repeat(64) }, ...overrides,
});
const section = (props: Partial<React.ComponentProps<typeof ReportCandidatesSection>>) =>
  renderToStaticMarkup(<ReportCandidatesSection taskId={TASK} eligible candidates={[]} {...props} />);
const respond = (status: number, body: unknown, calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;

test("W1 the designation control appears only on ready candidates and only without an official report", () => {
  const statuses = ["ready", "generating", "failed", "outdated", "official", "superseded"] as const;
  for (const status of statuses) {
    const markup = section({ candidates: [candidate({ status, file: status === "generating" || status === "failed" ? null : candidate().file })] });
    const has = buttons(markup).some((button) => button.label === fr.report.designate.button);
    assert.equal(has, status === "ready", status);
  }
  const withOfficial = section({ official: officialReport(), candidates: [candidate({ status: "official" }), candidate({ id: OTHER, status: "superseded" })] });
  assert.deepEqual(buttons(withOfficial), []);
});

test("W2 the click opens an irreversible confirmation with cancel; confirming shows the designating state with disabled controls", () => {
  const idle = section({ candidates: [candidate()] });
  assert.ok(!decode(idle).includes(fr.report.designate.prompt));
  const asking = section({ candidates: [candidate()], confirmingId: ID });
  assert.ok(decode(asking).includes(fr.report.designate.prompt));
  assert.deepEqual(buttons(asking).map((button) => button.label).filter((label) => label !== fr.report.generate), [fr.report.designate.confirm, fr.report.designate.cancel]);
  const busy = section({ candidates: [candidate()], confirmingId: ID, designatingId: ID });
  const labels = buttons(busy).map((button) => button.label);
  assert.ok(labels.includes(fr.report.designate.pending) && !labels.includes(fr.report.designate.confirm));
  for (const button of buttons(busy)) assert.ok(/disabled/.test(button.attrs), button.label);
});

test("W3 after designation: official label with actor and date, superseded label, no generate, retry, designate or attach control, download kept", () => {
  const markup = section({
    official: officialReport(), failedAttempt: true,
    candidates: [candidate({ status: "official" }), candidate({ id: OTHER, status: "superseded" })],
  });
  const text = decode(markup);
  for (const expected of [fr.report.status.official, fr.report.status.superseded, "désigné par Responsable Test", fr.report.download]) assert.ok(text.includes(expected), expected);
  assert.deepEqual(buttons(markup), []);
  assert.ok(!text.includes(fr.report.notEligible));
  const pdf = renderToStaticMarkup(<PdfFilesSection taskId={TASK} eligible official files={[{
    id: ID, fileName: "Rapport.pdf", status: "ready", byteSize: 100, uploadedAt: "2026-10-08T12:00:00.000Z", uploadedBy: { id: USER, displayName: "Responsable Test" },
    validation: { result: "accepted", class: null }, scan: { result: "not-performed", scanner: null, checkedAt: null },
  } as never]} />);
  assert.ok(!buttons(pdf).some((button) => button.label === fr.pdfFile.createCandidate));
});

test("W4 each designation refusal maps to its French message; success and failures map to their kinds; no English text", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  assert.deepEqual(await designateReportCandidateOnServer(TASK, ID, respond(201, officialReport(), calls)), { kind: "designated", official: officialReport() });
  assert.deepEqual([calls[0]!.url, calls[0]!.init?.method, calls[0]!.init?.body], [`/api/tasks/${TASK}/report-candidates/${ID}/designate`, "POST", "{}"]);
  assert.equal((await designateReportCandidateOnServer(TASK, ID, respond(200, officialReport()))).kind, "designated");
  for (const [code, message] of [
    ["REPORT_CANDIDATE_NOT_READY", fr.report.designate.notReady], ["REPORT_CANDIDATE_OUTDATED", fr.report.designate.outdated],
    ["REPORT_ALREADY_OFFICIAL", fr.report.designate.alreadyOfficial],
  ] as const) {
    assert.deepEqual(await designateReportCandidateOnServer(TASK, ID, respond(409, { error: { code, message: "x" } })), { kind: "refused", message });
  }
  assert.deepEqual(await designateReportCandidateOnServer(TASK, ID, respond(404, { error: { code: "TASK_NOT_FOUND", message: "x" } })), { kind: "refused", message: fr.report.designate.notFound });
  assert.deepEqual(await designateReportCandidateOnServer(TASK, ID, respond(500, { error: { code: "INTERNAL_ERROR", message: "x" } })), { kind: "failed" });
  assert.deepEqual(await designateReportCandidateOnServer(TASK, ID, respond(201, { id: 1 })), { kind: "failed" });
  assert.deepEqual(await designateReportCandidateOnServer(TASK, ID, (async () => { throw new Error("réseau"); }) as typeof fetch), { kind: "failed" });
  assert.deepEqual(await loadOfficialReport(TASK, respond(200, officialReport())), officialReport());
  assert.equal(await loadOfficialReport(TASK, respond(404, { error: { code: "TASK_NOT_FOUND", message: "x" } })), null);
  assert.equal(await loadOfficialReport(TASK, (async () => { throw new Error("réseau"); }) as typeof fetch), null);
  const english = /(?<!\p{L})(designate|official report|confirm|cancel|pending|superseded)(?!\p{L})/iu;
  const all = Object.values(fr.report.designate).join(" ") + fr.report.status.official + fr.report.status.superseded;
  assert.ok(!english.test(all), all);
});

test("W5 the Next handlers check CSRF, forward the session cookie only, pass status and body through and answer 503 when unreachable", async () => {
  const original = globalThis.fetch;
  const token = "opaque-session-token-value-not-for-the-browser";
  const url = `http://localhost/api/tasks/${TASK}/report-candidates/${ID}/designate`;
  const designateContext = { params: Promise.resolve({ taskId: TASK, candidateId: ID }) };
  const officialContext = { params: Promise.resolve({ taskId: TASK }) };
  const officialUrl = `http://localhost/api/tasks/${TASK}/official-report`;
  let forwarded = 0;
  try {
    globalThis.fetch = async () => { forwarded++; return Response.json({}); };
    const rejectedHeaders: Array<Record<string, string>> = [{ cookie: `cetem_qc_session=${token}` }, { cookie: `cetem_qc_session=${token}`, origin: "https://evil.example.test" }];
    for (const headers of rejectedHeaders) {
      const rejected = await DESIGNATE(new Request(url, { method: "POST", headers, body: "{}" }), designateContext);
      assert.equal(rejected.status, 403);
    }
    assert.equal((await DESIGNATE(new Request(url, { method: "POST", headers: { origin: "http://localhost" }, body: "{}" }), designateContext)).status, 401);
    assert.equal((await OFFICIAL(new Request(officialUrl), officialContext)).status, 401);
    assert.equal(forwarded, 0);

    for (const [status, payload] of [[201, { id: "o1" }], [200, { id: "o1" }], [404, { error: { code: "TASK_NOT_FOUND", message: "x" } }], [409, { error: { code: "REPORT_ALREADY_OFFICIAL", message: "x" } }]] as const) {
      const calls: Array<{ url: string; authorization: string | null; method?: string; body?: unknown }> = [];
      globalThis.fetch = async (input, init) => {
        calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), method: init?.method, body: init?.body });
        return Response.json(payload, { status });
      };
      const response = await DESIGNATE(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body: "{}" }), designateContext);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), payload);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.deepEqual([calls[0]!.url, calls[0]!.authorization, calls[0]!.method, calls[0]!.body],
        [`http://127.0.0.1:3001/api/v1/tasks/${TASK}/report-candidates/${ID}/designate`, `Bearer ${token}`, "POST", "{}"]);
      const read = await OFFICIAL(new Request(officialUrl, { headers: { cookie: `cetem_qc_session=${token}` } }), officialContext);
      assert.equal(read.status, status);
      assert.equal(calls[1]!.url, `http://127.0.0.1:3001/api/v1/tasks/${TASK}/official-report`);
    }

    globalThis.fetch = async () => { throw new Error("hors ligne"); };
    const down = await DESIGNATE(new Request(url, { method: "POST", headers: { origin: "http://localhost", cookie: `cetem_qc_session=${token}` }, body: "{}" }), designateContext);
    assert.equal(down.status, 503);
    assert.equal((await OFFICIAL(new Request(officialUrl, { headers: { cookie: `cetem_qc_session=${token}` } }), officialContext)).status, 503);
  } finally { globalThis.fetch = original; }
});
