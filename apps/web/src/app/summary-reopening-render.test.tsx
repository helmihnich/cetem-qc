import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AcceptedEvidenceResponse, ConfirmedSummary, SummaryHistoryItem } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { SummaryDraftSection, reopenSummaryOnServer } from "./summary-draft";

// Story 10.3 (W37–W42): reopening a confirmed summary and the version history. Synthetic names only.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const TASK = "00000000-0000-4000-8000-000000000301";
const SUMMARY_ID = "00000000-0000-4000-8000-000000000302";
const USER = "00000000-0000-4000-8000-000000000303";
const decode = (markup: string) => markup.replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", "\"").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const confirmed = (overrides: Partial<ConfirmedSummary> = {}): ConfirmedSummary => ({
  id: SUMMARY_ID, version: 1, text: "Synthèse finale.", confirmedAt: "2026-10-08T10:00:00.000Z", confirmedBy: { id: USER, displayName: "Responsable Test" },
  summaryInputSetId: "b".repeat(64), initialDraft: null, ...overrides,
});
const historyItem = (version: number, text = `Texte version ${version}.`): SummaryHistoryItem => ({
  version, text, confirmedAt: "2026-10-08T10:00:00.000Z", confirmedBy: { id: USER, displayName: "Responsable Test" },
  reopenedAt: "2026-10-08T11:00:00.000Z", reopenedBy: { id: USER, displayName: "Responsable Test" }, initialDraft: null,
});
const reopening = () => ({ version: 2, reopenedAt: "2026-10-08T11:00:00.000Z", reopenedBy: { id: USER, displayName: "Responsable Test" }, previous: confirmed() });
const section = (props: Partial<React.ComponentProps<typeof SummaryDraftSection>>) => renderToStaticMarkup(<SummaryDraftSection text="" {...props} />);
const buttonLabels = (markup: string) => [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
const respond = (status: number, body: unknown, calls: Array<{ url: string; body: unknown }> = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: init?.body }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;

test("W37 the reopen button shows only in the confirmed state; the prompt offers « Rouvrir » and « Annuler »", () => {
  assert.ok(buttonLabels(section({ summary: confirmed() })).includes(fr.summary.reopen));
  assert.ok(!buttonLabels(section({ text: "Texte." })).includes(fr.summary.reopen));
  const prompt = section({ summary: confirmed(), reopenPrompt: true });
  const text = decode(prompt);
  assert.ok(text.includes(fr.summary.reopenPrompt));
  assert.deepEqual(buttonLabels(prompt).slice(-2), [fr.summary.reopenYes, fr.summary.reopenCancel]);
  assert.ok(!buttonLabels(prompt).includes(fr.summary.reopen));
  assert.ok(!decode(section({ summary: confirmed() })).includes(fr.summary.reopenPrompt));
});

test("W37 the reopen request sends an empty object to the web route and only a valid 201 counts", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  assert.deepEqual(await reopenSummaryOnServer(TASK, respond(201, reopening(), calls)), { kind: "reopened", reopening: reopening() });
  assert.equal(calls[0]!.url, `/api/tasks/${TASK}/summary-reopening`);
  assert.equal(calls[0]!.body, "{}");
  assert.deepEqual(await reopenSummaryOnServer(TASK, respond(201, { ...reopening(), version: 1 })), { kind: "failed" });
});

test("W38 an open version shows the version note, the unconfirmed controls and the confirm button", () => {
  const markup = section({ text: "Synthèse finale.", version: { number: 2, state: "open" }, history: [historyItem(1)], onRequest: () => undefined });
  const text = decode(markup);
  assert.ok(text.includes("Version 2 à confirmer — la version 1 reste dans l’historique."));
  assert.ok(text.includes(fr.summary.heading) && !text.includes(fr.summary.confirmedHeading));
  assert.match(markup, /<textarea id="summary-text"[^>]*>Synthèse finale\.<\/textarea>/);
  const labels = buttonLabels(markup);
  for (const label of [fr.summary.request, fr.summary.confirm]) assert.ok(labels.includes(label), label);
  assert.ok(!labels.includes(fr.summary.reopen));
  assert.ok(!decode(section({ text: "Texte.", version: { number: 1, state: "open" } })).includes("à confirmer —"));
});

test("W39 after a reload while open the editor is empty and the previous text is offered through a button", () => {
  const markup = section({ text: "", version: { number: 2, state: "open" }, history: [historyItem(1, "Ancien texte.")] });
  assert.match(markup, /<textarea id="summary-text"[^>]*><\/textarea>/);
  assert.ok(buttonLabels(markup).includes("Reprendre le texte de la version 1"));
  assert.ok(!buttonLabels(section({ text: "", version: { number: 1, state: "open" } })).includes("Reprendre le texte de la version 1"));
});

test("W40 failures keep the confirmed state; refusals use their own French messages", async () => {
  for (const status of [500, 422, 403, 404, 503, 200]) assert.deepEqual(await reopenSummaryOnServer(TASK, respond(status, {})), { kind: "failed" }, String(status));
  assert.deepEqual(await reopenSummaryOnServer(TASK, (async () => { throw new Error("offline"); }) as typeof fetch), { kind: "failed" });
  assert.deepEqual(await reopenSummaryOnServer(TASK, respond(409, { error: { code: "SUMMARY_NOT_CONFIRMED", message: "m" } })), { kind: "not-confirmed" });
  assert.deepEqual(await reopenSummaryOnServer(TASK, respond(409, { error: { code: "SUMMARY_DESIGNATED", message: "m" } })), { kind: "designated" });
  assert.deepEqual(await reopenSummaryOnServer(TASK, respond(409, { error: { code: "OTHER", message: "m" } })), { kind: "failed" });
  const failed = decode(section({ summary: confirmed(), reopenMessage: fr.summary.reopenFailed }));
  assert.ok(failed.includes("La synthèse n’a pas pu être rouverte.") && failed.includes(fr.summary.confirmedHeading));
  assert.equal(fr.summary.reopenNotConfirmed, "La synthèse n’est pas confirmée : elle ne peut pas être rouverte.");
  assert.equal(fr.summary.reopenDesignated, "Un rapport officiel est désigné : la synthèse ne peut plus être rouverte.");
});

test("W41 the history is read only, newest first, absent when empty, and shows markup as text", () => {
  assert.ok(!section({ summary: confirmed(), history: [] }).includes("summary-history"));
  const raw = "<b>gras</b> & <script>x</script>";
  const markup = section({ summary: confirmed({ version: 3 }), history: [historyItem(2, raw), historyItem(1)] });
  const block = /<section class="summary-history"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";
  assert.ok(block !== "" && !block.includes("<b>gras") && !block.includes("<script>"));
  assert.ok(!/<(button|textarea|input|form)\b/.test(block));
  const text = decode(block);
  assert.ok(text.includes(fr.summary.historyHeading));
  assert.ok(text.indexOf("Version 2 — remplacée") >= 0 && text.indexOf("Version 2 — remplacée") < text.indexOf("Version 1 — remplacée"));
  assert.ok(text.includes("Confirmée par Responsable Test le "));
});

test("W42 no conformity-decision or report control and no English text", () => {
  const english = /(?<!\p{L})(save|approve|conformity|draft|summary|request|loading|confirm|report|reopen)(?!\p{L})/iu;
  const markups: Array<Partial<React.ComponentProps<typeof SummaryDraftSection>>> = [
    { summary: confirmed(), history: [historyItem(1)] },
    { summary: confirmed(), reopenPrompt: true },
    { text: "Texte.", version: { number: 2, state: "open" as AcceptedEvidenceResponse["summaryVersion"]["state"] }, history: [historyItem(1)] },
  ];
  for (const props of markups) {
    const text = decode(section(props));
    assert.ok(!/Machine conforme|Rapport|Word|PDF/.test(text), text);
    assert.ok(!english.test(text.replace("Texte version 1.", "")), text);
  }
});
