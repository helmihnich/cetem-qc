import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportCandidate } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { InsightProposalsPanel } from "./accepted-evidence";
import { generateReportCandidateOnServer, loadReportCandidates, reportDownloadUrl, ReportCandidatesSection } from "./report-candidates";

// Story 11.1 (U1–U7): the report area of the W5 panel. Synthetic names only.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const TASK = "00000000-0000-4000-8000-000000000501";
const ID = "00000000-0000-4000-8000-000000000502";
const USER = "00000000-0000-4000-8000-000000000503";
const ATTEMPT = "00000000-0000-4000-8000-000000000504";
const decode = (markup: string) => markup.replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", "\"").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((match) => ({ attrs: match[1]!, label: match[2]! }));
const candidate = (overrides: Partial<ReportCandidate> = {}): ReportCandidate => ({
  id: ID, attemptId: ATTEMPT, origin: "generated-word", status: "ready", requestedAt: "2026-10-08T12:00:00.000Z",
  requestedBy: { id: USER, displayName: "Responsable Test" },
  bindings: { auditRevision: 1, summaryId: ID, summaryVersion: 2, conformityDecisionId: ID, conformityOutcome: "machine-conforme" },
  template: { id: "cetem-paper-report", version: "1.0.0" },
  file: { name: "Rapport-LCQ-candidat-20261008-00000000.docx", byteSize: 1234, sha256: "a".repeat(64) },
  failureClass: null, ...overrides,
});
const section = (props: Partial<React.ComponentProps<typeof ReportCandidatesSection>>) =>
  renderToStaticMarkup(<ReportCandidatesSection taskId={TASK} eligible={false} candidates={[]} {...props} />);
const respond = (status: number, body: unknown, calls: Array<{ url: string; body: unknown }> = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: init?.body }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;

test("U1 U2 not eligible: no generate button and the explanatory text", () => {
  const markup = section({});
  assert.deepEqual(buttons(markup), []);
  assert.ok(decode(markup).includes(fr.report.notEligible));
  assert.ok(decode(markup).includes(fr.report.heading));
});

test("U3 eligible: the generate button, then the loading state with a disabled button", () => {
  const idle = section({ eligible: true });
  assert.deepEqual(buttons(idle).map((button) => button.label), [fr.report.generate]);
  assert.ok(!decode(idle).includes(fr.report.notEligible));
  const busy = section({ eligible: true, pending: true });
  assert.deepEqual(buttons(busy).map((button) => button.label), [fr.report.generating]);
  assert.ok(/disabled/.test(buttons(busy)[0]!.attrs) && /aria-busy="true"/.test(buttons(busy)[0]!.attrs));
});

test("U3 a ready candidate shows the non-official badge, status, author, date, versions and the download link", () => {
  const markup = section({ eligible: true, candidates: [candidate()] });
  const text = decode(markup);
  for (const expected of [fr.report.candidateBadge, fr.report.status.ready, "par Responsable Test", "synthèse version 2", "décision : Machine conforme", fr.report.download]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(markup.includes(`href="${reportDownloadUrl(TASK, ID)}"`));
  const nonConforme = section({ eligible: true, candidates: [candidate({ bindings: { ...candidate().bindings, conformityOutcome: "machine-non-conforme" } })] });
  assert.ok(decode(nonConforme).includes("décision : Machine non conforme"));
});

test("U4 a failed attempt shows the French message and « Réessayer »; a failed candidate has no download link", () => {
  const markup = section({ eligible: true, failedAttempt: true, message: fr.report.failed, candidates: [candidate({ status: "failed", file: null, failureClass: "generation-failed" })] });
  const text = decode(markup);
  assert.ok(text.includes(fr.report.failed) && text.includes(fr.report.status.failed));
  assert.deepEqual(buttons(markup).map((button) => button.label), [fr.report.retry]);
  assert.ok(!text.includes(fr.report.download));
});

test("U4 the request body holds the attempt ID only and each outcome maps to its kind", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  assert.deepEqual(await generateReportCandidateOnServer(TASK, ATTEMPT, respond(201, candidate(), calls)), { kind: "generated", candidate: candidate() });
  assert.equal(calls[0]!.url, `/api/tasks/${TASK}/report-candidates`);
  assert.equal(calls[0]!.body, JSON.stringify({ attemptId: ATTEMPT }));
  assert.deepEqual(await generateReportCandidateOnServer(TASK, ATTEMPT, respond(502, { error: { code: "REPORT_GENERATION_FAILED", message: "x" } })), { kind: "generation-failed" });
  assert.deepEqual(await generateReportCandidateOnServer(TASK, ATTEMPT, respond(500, { error: { code: "INTERNAL_ERROR", message: "x" } })), { kind: "failed" });
  assert.deepEqual(await generateReportCandidateOnServer(TASK, ATTEMPT, respond(201, { ...candidate(), status: "x" })), { kind: "failed" });
});

test("U4 a transport error is retried once with the same attempt ID, then fails", async () => {
  const attempts: unknown[] = [];
  const flaky = (async (_url: string | URL | Request, init?: RequestInit) => {
    attempts.push(init?.body);
    if (attempts.length === 1) throw new Error("réseau");
    return new Response(JSON.stringify(candidate()), { status: 201 });
  }) as typeof fetch;
  assert.equal((await generateReportCandidateOnServer(TASK, ATTEMPT, flaky)).kind, "generated");
  assert.deepEqual(attempts, [JSON.stringify({ attemptId: ATTEMPT }), JSON.stringify({ attemptId: ATTEMPT })]);
  assert.deepEqual(await generateReportCandidateOnServer(TASK, ATTEMPT, (async () => { throw new Error("réseau"); }) as typeof fetch), { kind: "failed" });
});

test("U5 409 refusals map to their French messages", async () => {
  for (const [code, message] of [
    ["SUMMARY_NOT_CONFIRMED", fr.report.notConfirmed], ["CONFORMITY_NOT_DECIDED", fr.report.notDecided],
    ["REPORT_INPUTS_CHANGED", fr.report.inputsChanged], ["REPORT_ATTEMPT_CONFLICT", fr.report.attemptConflict],
  ] as const) {
    assert.deepEqual(await generateReportCandidateOnServer(TASK, ATTEMPT, respond(409, { error: { code, message: "x" } })), { kind: "refused", message });
  }
  assert.deepEqual(await generateReportCandidateOnServer(TASK, ATTEMPT, respond(409, { error: { code: "OTHER", message: "x" } })), { kind: "failed" });
  assert.ok(decode(section({ eligible: false, message: fr.report.notConfirmed })).includes(fr.report.notConfirmed));
});

test("U6 an outdated candidate shows its label and keeps its download link", () => {
  const markup = section({ eligible: false, candidates: [candidate({ status: "outdated" })] });
  assert.ok(decode(markup).includes(fr.report.status.outdated));
  assert.ok(markup.includes(`href="${reportDownloadUrl(TASK, ID)}"`));
});

test("U6 the list is read back from the server and only a valid list counts", async () => {
  assert.deepEqual(await loadReportCandidates(TASK, respond(200, { candidates: [candidate()] })), [candidate()]);
  assert.equal(await loadReportCandidates(TASK, respond(404, { error: { code: "TASK_NOT_FOUND", message: "x" } })), null);
  assert.equal(await loadReportCandidates(TASK, respond(200, { candidates: [{ id: 1 }] })), null);
  assert.equal(await loadReportCandidates(TASK, (async () => { throw new Error("réseau"); }) as typeof fetch), null);
});

test("U7 no designation, upload or « officiel » control and no English text; markup in names is shown as text", () => {
  const raw = "<b>gras</b> & <script>x</script>";
  const markups = [
    section({}), section({ eligible: true }), section({ eligible: true, pending: true }), section({ eligible: true, failedAttempt: true, message: fr.report.failed }),
    section({ eligible: true, candidates: [candidate({ requestedBy: { id: USER, displayName: raw } }), candidate({ status: "outdated" }), candidate({ status: "failed", file: null, failureClass: "storage-failed" }), candidate({ status: "generating", file: null })] }),
  ];
  const english = /(?<!\p{L})(save|approve|report|confirm|loading|summary|download|upload|retry|official)(?!\p{L})/iu;
  for (const markup of markups) {
    assert.ok(!markup.includes("<b>gras") && !markup.includes("<script>"));
    assert.ok(!/<input|type="file"/.test(markup));
    const text = decode(markup).replaceAll(raw, "");
    assert.ok(!/Désigner|Téléverser|Importer|officiel(?!\s*$)/.test(text.replaceAll(fr.report.candidateBadge, "")), text);
    assert.ok(!english.test(text), text);
  }
});

test("U7 the evidence panel shows the report area: explanation until eligible, then the button", () => {
  const confirmed = { id: ID, version: 1, text: "Synthèse.", confirmedAt: "2026-10-08T10:00:00.000Z", confirmedBy: { id: USER, displayName: "Responsable Test" }, summaryInputSetId: "b".repeat(64), initialDraft: null };
  const decision = { id: ID, outcome: "machine-conforme" as const, decidedAt: "2026-10-08T12:00:00.000Z", decidedBy: { id: USER, displayName: "Responsable Test" }, summaryId: ID, summaryVersion: 1 };
  const panel = (props: Record<string, unknown>) => renderToStaticMarkup(<InsightProposalsPanel taskId={TASK} insights={{ status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] }} initialDecisions={[]} {...props} />);
  for (const markup of [panel({}), panel({ initialSummary: confirmed })]) {
    assert.ok(decode(markup).includes(fr.report.notEligible));
    assert.ok(!buttons(markup).some((button) => button.label === fr.report.generate));
  }
  const eligible = panel({ initialSummary: confirmed, initialConformityDecision: decision });
  assert.ok(buttons(eligible).some((button) => button.label === fr.report.generate));
  assert.ok(!decode(eligible).includes(fr.report.notEligible));
});
