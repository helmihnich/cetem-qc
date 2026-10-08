import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportCandidate, StoredFile } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { InsightProposalsPanel } from "./accepted-evidence";
import { attachPdfCandidateOnServer, hasCurrentCandidate, loadPdfFiles, pdfDownloadUrl, PdfFilesSection, precheckPdf, retryPdfScanOnServer, uploadPdfOnServer } from "./pdf-files";
import { ReportCandidatesSection } from "./report-candidates";

// Story 11.2 (W1–W5, W7): the « Rapport PDF manuel » area of the W5 panel. Synthetic names only.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const TASK = "00000000-0000-4000-8000-000000000601";
const ID = "00000000-0000-4000-8000-000000000602";
const USER = "00000000-0000-4000-8000-000000000603";
const ATTEMPT = "00000000-0000-4000-8000-000000000604";
const decode = (markup: string) => markup.replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", "\"").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((match) => ({ attrs: match[1]!, label: match[2]! }));
const stored = (overrides: Partial<StoredFile> = {}): StoredFile => ({
  id: ID, attemptId: ATTEMPT, status: "ready", fileName: "Rapport signé.pdf", byteSize: 2048, sha256: "a".repeat(64),
  uploadedAt: "2026-10-08T12:00:00.000Z", uploadedBy: { id: USER, displayName: "Responsable Test" },
  validation: { result: "passed", class: null }, scan: { result: "clean", scanner: "clamav", checkedAt: "2026-10-08T12:00:01.000Z" }, ...overrides,
});
const section = (props: Partial<React.ComponentProps<typeof PdfFilesSection>>) =>
  renderToStaticMarkup(<PdfFilesSection taskId={TASK} eligible={false} files={[]} {...props} />);
const respond = (status: number, body: unknown, calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
const file = { name: "Rapport signé.pdf", bytes: new Uint8Array([37, 80, 68, 70]).buffer };

test("W1 not eligible: explanatory text and no upload control; eligible: a PDF-only file input and « Importer un rapport PDF »", () => {
  const closed = section({});
  assert.deepEqual(buttons(closed), []);
  assert.ok(!/<input/.test(closed));
  assert.ok(decode(closed).includes(fr.pdfFile.notEligible) && decode(closed).includes(fr.pdfFile.heading));
  const open = section({ eligible: true, hasSelection: true });
  assert.deepEqual(buttons(open).map((button) => button.label), [fr.pdfFile.upload]);
  assert.match(open, /<input[^>]*type="file"[^>]*accept="application\/pdf,\.pdf"|<input[^>]*accept="application\/pdf,\.pdf"[^>]*type="file"/);
  assert.ok(!decode(open).includes(fr.pdfFile.notEligible));
  assert.ok(/disabled/.test(buttons(section({ eligible: true }))[0]!.attrs), "no file chosen yet");
});

test("W2 uploading: « Envoi en cours… », the control and the input are disabled", () => {
  const busy = section({ eligible: true, pending: true, hasSelection: true });
  assert.deepEqual(buttons(busy).map((button) => button.label), [fr.pdfFile.uploading]);
  assert.ok(/disabled/.test(buttons(busy)[0]!.attrs) && /aria-busy="true"/.test(buttons(busy)[0]!.attrs));
  assert.match(busy, /<input[^>]*disabled/);
});

test("W3 each status shows its French label, reason and scan note; download only for ready; rescan only for scan-failed and scan-pending", () => {
  const cases: Array<[Partial<StoredFile>, string, string | null]> = [
    [{}, fr.pdfFile.status.ready, null],
    [{ status: "rejected", validation: { result: "rejected", class: "not-pdf" }, scan: { result: "pending", scanner: null, checkedAt: null } }, fr.pdfFile.status.rejected, fr.pdfFile.reason["not-pdf"]],
    [{ status: "rejected", validation: { result: "rejected", class: "truncated" }, scan: { result: "pending", scanner: null, checkedAt: null } }, fr.pdfFile.status.rejected, fr.pdfFile.reason.truncated],
    [{ status: "rejected", validation: { result: "rejected", class: "corrupt-structure" }, scan: { result: "pending", scanner: null, checkedAt: null } }, fr.pdfFile.status.rejected, fr.pdfFile.reason["corrupt-structure"]],
    [{ status: "rejected", validation: { result: "rejected", class: "encrypted" }, scan: { result: "pending", scanner: null, checkedAt: null } }, fr.pdfFile.status.rejected, fr.pdfFile.reason.encrypted],
    [{ status: "quarantined", validation: { result: "quarantined", class: "active-content" }, scan: { result: "pending", scanner: null, checkedAt: null } }, fr.pdfFile.status.quarantined, fr.pdfFile.reason["active-content"]],
    [{ status: "quarantined", scan: { result: "threat", scanner: "clamav", checkedAt: "2026-10-08T12:00:01.000Z" } }, fr.pdfFile.status.quarantined, fr.pdfFile.reason.threat],
    [{ status: "scan-failed", scan: { result: "unavailable", scanner: "clamav", checkedAt: "2026-10-08T12:00:01.000Z" } }, fr.pdfFile.status["scan-failed"], fr.pdfFile.reason.unavailable],
    [{ status: "scan-pending", scan: { result: "pending", scanner: null, checkedAt: null } }, fr.pdfFile.status["scan-pending"], fr.pdfFile.reason.pending],
    [{ status: "storage-failed", scan: { result: "pending", scanner: null, checkedAt: null } }, fr.pdfFile.status["storage-failed"], fr.pdfFile.reason["storage-failed"]],
  ];
  for (const [overrides, label, reason] of cases) {
    const markup = section({ eligible: true, files: [stored(overrides)] });
    const text = decode(markup);
    assert.ok(text.includes(label), label);
    if (reason) assert.ok(text.includes(reason), reason);
    assert.equal(markup.includes(`href="${pdfDownloadUrl(TASK, ID)}"`), overrides.status === undefined, label);
    const rescannable = overrides.status === "scan-failed" || overrides.status === "scan-pending";
    assert.deepEqual(buttons(markup).filter((button) => button.label === fr.pdfFile.rescan).length, rescannable ? 1 : 0, label);
  }
  const note = section({ eligible: true, files: [stored({ scan: { result: "not-performed", scanner: "none", checkedAt: "2026-10-08T12:00:01.000Z" } })] });
  assert.ok(decode(note).includes(fr.pdfFile.scanNote) && decode(note).includes(fr.pdfFile.download));
  assert.ok(!decode(section({ eligible: true, files: [stored()] })).includes(fr.pdfFile.scanNote));
  const text = decode(section({ eligible: true, files: [stored()] }));
  for (const expected of ["Rapport signé.pdf", "2 Ko", "par Responsable Test", "le "]) assert.ok(text.includes(expected), expected);
});

test("W4 the client pre-check refuses another type or more than 20 Mo; each server refusal maps to its French message; a transport error reuses the attempt ID", async () => {
  assert.equal(precheckPdf({ type: "image/png", size: 10 }), fr.pdfFile.wrongType);
  assert.equal(precheckPdf({ type: "application/pdf", size: 20 * 1024 * 1024 + 1 }), fr.pdfFile.tooLarge);
  assert.equal(precheckPdf({ type: "application/pdf", size: 20 * 1024 * 1024 }), null);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  assert.deepEqual(await uploadPdfOnServer(TASK, ATTEMPT, file, respond(201, stored(), calls)), { kind: "stored", file: stored() });
  assert.equal(calls[0]!.url, `/api/tasks/${TASK}/pdf-files`);
  const headers = new Headers(calls[0]!.init?.headers);
  assert.deepEqual([headers.get("content-type"), headers.get("x-attempt-id"), decodeURIComponent(headers.get("x-file-name")!), calls[0]!.init?.body === file.bytes], ["application/pdf", ATTEMPT, "Rapport signé.pdf", true]);
  for (const [status, code, message] of [
    [413, "FILE_TOO_LARGE", fr.pdfFile.tooLarge], [415, "UNSUPPORTED_FILE_TYPE", fr.pdfFile.wrongType], [409, "SUMMARY_NOT_CONFIRMED", fr.pdfFile.notConfirmed],
    [409, "CONFORMITY_NOT_DECIDED", fr.pdfFile.notDecided], [409, "FILE_ATTEMPT_CONFLICT", fr.pdfFile.attemptConflict], [502, "FILE_STORAGE_FAILED", fr.pdfFile.storageFailed],
    [422, "VALIDATION_FAILED", fr.pdfFile.invalid],
  ] as const) {
    assert.deepEqual(await uploadPdfOnServer(TASK, ATTEMPT, file, respond(status, { error: { code, message: "x" } })), { kind: "refused", message }, code);
  }
  assert.deepEqual(await uploadPdfOnServer(TASK, ATTEMPT, file, respond(500, { error: { code: "INTERNAL_ERROR", message: "x" } })), { kind: "failed" });
  assert.deepEqual(await uploadPdfOnServer(TASK, ATTEMPT, file, respond(201, { ...stored(), status: "official" })), { kind: "failed" });
  const attempts: Array<string | null> = [];
  const flaky = (async (_url: string | URL | Request, init?: RequestInit) => {
    attempts.push(new Headers(init?.headers).get("x-attempt-id"));
    if (attempts.length === 1) throw new Error("réseau");
    return new Response(JSON.stringify(stored()), { status: 201 });
  }) as typeof fetch;
  assert.equal((await uploadPdfOnServer(TASK, ATTEMPT, file, flaky)).kind, "stored");
  assert.deepEqual(attempts, [ATTEMPT, ATTEMPT]);
  assert.deepEqual(await uploadPdfOnServer(TASK, ATTEMPT, file, (async () => { throw new Error("réseau"); }) as typeof fetch), { kind: "failed" });
  assert.ok(decode(section({ eligible: true, message: fr.pdfFile.tooLarge })).includes(fr.pdfFile.tooLarge));
});

test("W4 the list and the rescan are read from valid server responses only", async () => {
  assert.deepEqual(await loadPdfFiles(TASK, respond(200, { files: [stored()] })), [stored()]);
  assert.equal(await loadPdfFiles(TASK, respond(404, { error: { code: "TASK_NOT_FOUND", message: "x" } })), null);
  assert.equal(await loadPdfFiles(TASK, respond(200, { files: [{ id: 1 }] })), null);
  assert.equal(await loadPdfFiles(TASK, (async () => { throw new Error("réseau"); }) as typeof fetch), null);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  assert.deepEqual(await retryPdfScanOnServer(TASK, ID, respond(200, stored(), calls)), { kind: "rescanned", file: stored() });
  assert.deepEqual([calls[0]!.url, calls[0]!.init?.method], [`/api/tasks/${TASK}/pdf-files/${ID}/scan-retries`, "POST"]);
  assert.deepEqual(await retryPdfScanOnServer(TASK, ID, respond(409, { error: { code: "FILE_NOT_RESCANNABLE", message: "x" } })), { kind: "refused", message: fr.pdfFile.notRescannable });
  assert.deepEqual(await retryPdfScanOnServer(TASK, ID, respond(500, { error: { code: "INTERNAL_ERROR", message: "x" } })), { kind: "failed" });
});

test("W5 no designation control, a candidate-creation control only on a ready file when eligible, and no English text; the file name is rendered as text", () => {
  const raw = "<b>gras</b> & <script>x</script>.pdf";
  const markups = [
    section({}), section({ eligible: true }), section({ eligible: true, pending: true, hasSelection: true }), section({ eligible: true, message: fr.pdfFile.storageFailed }),
    section({ eligible: true, files: [stored({ fileName: raw }), stored({ status: "scan-failed", scan: { result: "unavailable", scanner: "clamav", checkedAt: null } }), stored({ status: "quarantined", validation: { result: "quarantined", class: "active-content" } })] }),
  ];
  const english = /(?<!\p{L})(save|approve|report|confirm|loading|summary|download|upload|retry|official|file|scan|failed)(?!\p{L})/iu;
  for (const markup of markups) {
    assert.ok(!markup.includes("<b>gras") && !markup.includes("<script>"));
    const text = decode(markup).replaceAll(raw, "");
    assert.ok(!/Désigner|Générer/.test(text) && !text.replaceAll("non officiel", "").includes("officiel"), text);
    const creates = buttons(markup).filter((button) => button.label === fr.pdfFile.createCandidate).length;
    assert.equal(creates, markup === markups[4] ? 1 : 0, "one ready file, eligible, without candidate");
    assert.ok(!english.test(text), text);
  }
  assert.ok(decode(markups[4]!).includes(raw));
});

test("W7 the evidence panel shows the PDF area: explanation until eligible, then the control; the Word candidate area keeps no upload control", () => {
  const confirmed = { id: ID, version: 1, text: "Synthèse.", confirmedAt: "2026-10-08T10:00:00.000Z", confirmedBy: { id: USER, displayName: "Responsable Test" }, summaryInputSetId: "b".repeat(64), initialDraft: null };
  const decision = { id: ID, outcome: "machine-conforme" as const, decidedAt: "2026-10-08T12:00:00.000Z", decidedBy: { id: USER, displayName: "Responsable Test" }, summaryId: ID, summaryVersion: 1 };
  const panel = (props: Record<string, unknown>) => renderToStaticMarkup(<InsightProposalsPanel taskId={TASK} insights={{ status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] }} initialDecisions={[]} {...props} />);
  for (const markup of [panel({}), panel({ initialSummary: confirmed })]) {
    assert.ok(decode(markup).includes(fr.pdfFile.notEligible));
    assert.ok(!/type="file"/.test(markup));
    assert.ok(!buttons(markup).some((button) => button.label === fr.pdfFile.upload));
  }
  const eligible = panel({ initialSummary: confirmed, initialConformityDecision: decision });
  assert.ok(buttons(eligible).some((button) => button.label === fr.pdfFile.upload));
  assert.equal([...eligible.matchAll(/type="file"/g)].length, 1, "only the PDF area has an upload control");
  assert.ok(eligible.indexOf(fr.report.heading) < eligible.indexOf(fr.pdfFile.heading), "the PDF area is below the Word candidates");
  assert.ok(!decode(eligible).includes(fr.pdfFile.notEligible));
});

const pdfCandidate = (overrides: Partial<ReportCandidate> = {}): ReportCandidate => ({
  id: ID, attemptId: ATTEMPT, origin: "uploaded-pdf", status: "ready", requestedAt: "2026-10-08T12:00:00.000Z",
  requestedBy: { id: USER, displayName: "Responsable Test" },
  bindings: { auditRevision: 1, summaryId: ID, summaryVersion: 1, conformityDecisionId: ID, conformityOutcome: "machine-conforme" },
  template: null, source: { fileId: ID, scanResult: "not-performed" },
  file: { name: "Rapport signé.pdf", byteSize: 2048, sha256: "a".repeat(64) }, failureClass: null, ...overrides,
});

test("W1 the create control appears only on a ready file when eligible and without a current candidate", () => {
  const others: Array<Partial<StoredFile>> = [
    { status: "rejected", validation: { result: "rejected", class: "not-pdf" } }, { status: "quarantined", validation: { result: "quarantined", class: "active-content" } },
    { status: "scan-failed", scan: { result: "unavailable", scanner: "clamav", checkedAt: null } }, { status: "scan-pending", scan: { result: "pending", scanner: null, checkedAt: null } },
    { status: "storage-failed" },
  ];
  const labels = (markup: string) => buttons(markup).map((button) => button.label);
  assert.deepEqual(labels(section({ eligible: true, files: [stored()] })), [fr.pdfFile.upload, fr.pdfFile.createCandidate]);
  assert.ok(!labels(section({ eligible: false, files: [stored()] })).includes(fr.pdfFile.createCandidate), "not eligible");
  for (const overrides of others) assert.ok(!labels(section({ eligible: true, files: [stored(overrides)] })).includes(fr.pdfFile.createCandidate), String(overrides.status));
  assert.ok(!decode(section({ eligible: true, files: [stored()] })).includes(fr.pdfFile.candidateCreated));
});

test("W2 creating state, then « Candidat créé — non officiel » and the PDF candidate in the list", () => {
  const busy = section({ eligible: true, files: [stored()], attachingId: ID });
  const button = buttons(busy).find((entry) => entry.label === fr.pdfFile.creatingCandidate)!;
  assert.ok(button && /disabled/.test(button.attrs) && /aria-busy="true"/.test(button.attrs));
  assert.ok(!buttons(busy).some((entry) => entry.label === fr.pdfFile.createCandidate));
  const created = section({ eligible: true, files: [stored()], candidates: [pdfCandidate()] });
  assert.ok(decode(created).includes(fr.pdfFile.candidateCreated));
  assert.ok(!buttons(created).some((entry) => entry.label === fr.pdfFile.createCandidate));
  const list = renderToStaticMarkup(<ReportCandidatesSection taskId={TASK} eligible candidates={[pdfCandidate()]} />);
  const text = decode(list);
  for (const expected of [fr.report.origin.uploadedPdf, fr.report.candidateBadge, fr.report.status.ready, fr.report.download, fr.pdfFile.scanNote]) assert.ok(text.includes(expected), expected);
  assert.ok(!text.includes(fr.report.status.failed) && !text.includes(fr.report.status.generating) && !text.includes("Désigner"));
  const word = decode(renderToStaticMarkup(<ReportCandidatesSection taskId={TASK} eligible candidates={[pdfCandidate({ origin: "generated-word", source: null, template: { id: "cetem-paper-report", version: "1.0.0" } })]} />));
  assert.ok(word.includes(fr.report.origin.generatedWord) && !word.includes(fr.report.origin.uploadedPdf));
});

test("W3 each refusal maps to its French message; a retry click uses a new attempt ID, a transport retry reuses it", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  assert.deepEqual(await attachPdfCandidateOnServer(TASK, ID, ATTEMPT, respond(201, pdfCandidate(), calls)), { kind: "attached", candidate: pdfCandidate() });
  assert.deepEqual([calls[0]!.url, calls[0]!.init?.method, calls[0]!.init?.body], [`/api/tasks/${TASK}/pdf-files/${ID}/report-candidate`, "POST", JSON.stringify({ attemptId: ATTEMPT })]);
  assert.equal((await attachPdfCandidateOnServer(TASK, ID, ATTEMPT, respond(200, pdfCandidate()))).kind, "attached");
  for (const [status, code, message] of [
    [409, "REPORT_FILE_NOT_READY", fr.pdfFile.candidateFileNotReady], [409, "REPORT_FILE_ALREADY_ATTACHED", fr.pdfFile.candidateAlreadyAttached],
    [409, "SUMMARY_NOT_CONFIRMED", fr.pdfFile.candidateNotConfirmed], [409, "CONFORMITY_NOT_DECIDED", fr.pdfFile.candidateNotDecided],
    [409, "REPORT_ATTEMPT_CONFLICT", fr.pdfFile.invalid], [404, "TASK_NOT_FOUND", fr.pdfFile.candidateNotFound], [422, "VALIDATION_FAILED", fr.pdfFile.invalid],
  ] as const) {
    assert.deepEqual(await attachPdfCandidateOnServer(TASK, ID, ATTEMPT, respond(status, { error: { code, message: "x" } })), { kind: "refused", message }, code);
  }
  assert.deepEqual(await attachPdfCandidateOnServer(TASK, ID, ATTEMPT, respond(500, { error: { code: "INTERNAL_ERROR", message: "x" } })), { kind: "failed" });
  assert.deepEqual(await attachPdfCandidateOnServer(TASK, ID, ATTEMPT, respond(201, { ...pdfCandidate(), origin: "official" })), { kind: "failed" });
  const bodies: unknown[] = [];
  const flaky = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(init?.body);
    if (bodies.length === 1) throw new Error("réseau");
    return new Response(JSON.stringify(pdfCandidate()), { status: 201 });
  }) as typeof fetch;
  assert.equal((await attachPdfCandidateOnServer(TASK, ID, ATTEMPT, flaky)).kind, "attached");
  assert.deepEqual(bodies, [JSON.stringify({ attemptId: ATTEMPT }), JSON.stringify({ attemptId: ATTEMPT })]);
  const other = "00000000-0000-4000-8000-000000000699";
  const second: unknown[] = [];
  await attachPdfCandidateOnServer(TASK, ID, other, respond(409, { error: { code: "REPORT_FILE_NOT_READY", message: "x" } }, second as Array<{ url: string; init?: RequestInit }>));
  assert.equal((second[0] as { init: RequestInit }).init.body, JSON.stringify({ attemptId: other }), "a new click sends its own attempt ID");
  assert.deepEqual(await attachPdfCandidateOnServer(TASK, ID, ATTEMPT, (async () => { throw new Error("réseau"); }) as typeof fetch), { kind: "failed" });
  assert.ok(decode(section({ eligible: true, files: [stored()], message: fr.pdfFile.candidateFileNotReady })).includes(fr.pdfFile.candidateFileNotReady));
});

test("W4 an outdated candidate shows its status and the file offers the create control again", () => {
  const outdated = pdfCandidate({ status: "outdated" });
  assert.equal(hasCurrentCandidate([outdated], ID), false);
  assert.equal(hasCurrentCandidate([pdfCandidate()], ID), true);
  assert.equal(hasCurrentCandidate([pdfCandidate({ source: { fileId: USER, scanResult: "clean" } })], ID), false);
  assert.ok(decode(renderToStaticMarkup(<ReportCandidatesSection taskId={TASK} eligible candidates={[outdated]} />)).includes(fr.report.status.outdated));
  const markup = section({ eligible: true, files: [stored()], candidates: [outdated] });
  assert.ok(buttons(markup).some((button) => button.label === fr.pdfFile.createCandidate));
});

test("W5 the new PDF candidate texts are French and carry no designation wording", () => {
  const texts = [fr.pdfFile.createCandidate, fr.pdfFile.creatingCandidate, fr.pdfFile.candidateCreated, fr.pdfFile.candidateNotConfirmed, fr.pdfFile.candidateNotDecided,
    fr.pdfFile.candidateFileNotReady, fr.pdfFile.candidateAlreadyAttached, fr.pdfFile.candidateNotFound, fr.pdfFile.candidateInternal, fr.report.origin.uploadedPdf, fr.report.origin.generatedWord];
  for (const text of texts) assert.ok(!/Désigner|official|designate/i.test(text.replace("non officiel", "")), text);
});
