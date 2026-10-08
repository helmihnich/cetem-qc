import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConformityDecision, ConformityHistoryItem } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { InsightProposalsPanel } from "./accepted-evidence";
import { ConformityDecisionSection, recordConformityDecisionOnServer } from "./conformity-decision";

// Story 10.4 (W44–W49): the decision area of the W5 panel. Synthetic names only.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const TASK = "00000000-0000-4000-8000-000000000401";
const ID = "00000000-0000-4000-8000-000000000402";
const USER = "00000000-0000-4000-8000-000000000403";
const decode = (markup: string) => markup.replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", "\"").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const decision = (overrides: Partial<ConformityDecision> = {}): ConformityDecision => ({
  id: ID, outcome: "machine-conforme", decidedAt: "2026-10-08T12:00:00.000Z", decidedBy: { id: USER, displayName: "Responsable Test" }, summaryId: ID, summaryVersion: 1, ...overrides,
});
const historyItem = (overrides: Partial<ConformityHistoryItem> = {}): ConformityHistoryItem => ({ ...decision(), invalidatedAt: "2026-10-08T13:00:00.000Z", ...overrides });
const section = (props: Partial<React.ComponentProps<typeof ConformityDecisionSection>>) => renderToStaticMarkup(<ConformityDecisionSection confirmedVersion={null} decision={null} {...props} />);
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((match) => ({ attrs: match[1]!, label: match[2]! }));
const respond = (status: number, body: unknown, calls: Array<{ url: string; body: unknown }> = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: init?.body }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;

test("W44 summary open: no decision button and the explanation; confirmed with no decision: both buttons, none selected or primary", () => {
  const open = section({});
  assert.deepEqual(buttons(open), []);
  assert.ok(decode(open).includes(fr.conformity.awaitingSummary));
  const confirmed = section({ confirmedVersion: 1 });
  assert.deepEqual(buttons(confirmed).map((button) => button.label), [fr.conformity.conforme, fr.conformity.nonConforme]);
  for (const button of buttons(confirmed)) {
    assert.ok(button.attrs.includes("secondary-button") && !button.attrs.includes("primary-button"), button.attrs);
    assert.ok(!/aria-pressed|autofocus|autoFocus|aria-selected|disabled/.test(button.attrs), button.attrs);
  }
  assert.ok(decode(confirmed).includes(fr.conformity.heading));
  assert.ok(!decode(confirmed).includes(fr.conformity.awaitingSummary));
});

test("W45 the prompt names the label and the summary version with « Enregistrer » / « Annuler »; the request body holds the outcome only", async () => {
  for (const [outcome, label] of [["machine-conforme", fr.conformity.conforme], ["machine-non-conforme", fr.conformity.nonConforme]] as const) {
    const prompt = section({ confirmedVersion: 3, prompt: outcome });
    assert.ok(decode(prompt).includes(`Enregistrer la décision « ${label} » ? Elle restera liée à la version 3 de la synthèse ; elle ne pourra être modifiée qu’en rouvrant la synthèse.`));
    assert.deepEqual(buttons(prompt).map((button) => button.label), [fr.conformity.confirmYes, fr.conformity.confirmCancel]);
  }
  const calls: Array<{ url: string; body: unknown }> = [];
  assert.deepEqual(await recordConformityDecisionOnServer(TASK, "machine-non-conforme", respond(201, decision({ outcome: "machine-non-conforme" }), calls)), { kind: "recorded", decision: decision({ outcome: "machine-non-conforme" }) });
  assert.equal(calls[0]!.url, `/api/tasks/${TASK}/conformity-decision`);
  assert.equal(calls[0]!.body, JSON.stringify({ outcome: "machine-non-conforme" }));
});

test("W46 a recorded decision replaces the buttons; both outcomes render identically apart from the label", () => {
  const shown = (outcome: ConformityDecision["outcome"]) => section({ confirmedVersion: 1, decision: decision({ outcome }) });
  const conforme = shown("machine-conforme");
  const nonConforme = shown("machine-non-conforme");
  assert.deepEqual(buttons(conforme), []);
  assert.ok(decode(conforme).includes("Décision : Machine conforme — enregistrée par Responsable Test le "));
  assert.ok(decode(nonConforme).includes("Décision : Machine non conforme — enregistrée par Responsable Test le "));
  assert.equal(conforme.replace("Machine conforme", "X"), nonConforme.replace("Machine non conforme", "X"), "same markup, colour and wording");
});

test("W47 failures and 409s map to their kinds; only a valid 201 counts", async () => {
  for (const [status, body] of [[500, { error: { code: "INTERNAL_ERROR", message: "x" } }], [422, { error: { code: "VALIDATION_FAILED", message: "x" } }], [201, { ...decision(), outcome: "x" }]] as const) {
    assert.deepEqual(await recordConformityDecisionOnServer(TASK, "machine-conforme", respond(status, body)), { kind: "failed" });
  }
  assert.deepEqual(await recordConformityDecisionOnServer(TASK, "machine-conforme", (async () => { throw new Error("réseau"); }) as typeof fetch), { kind: "failed" });
  assert.deepEqual(await recordConformityDecisionOnServer(TASK, "machine-conforme", respond(409, { error: { code: "SUMMARY_NOT_CONFIRMED", message: "x" } })), { kind: "not-confirmed" });
  assert.deepEqual(await recordConformityDecisionOnServer(TASK, "machine-conforme", respond(409, { error: { code: "CONFORMITY_ALREADY_DECIDED", message: "x" } })), { kind: "already-decided" });
  assert.deepEqual(await recordConformityDecisionOnServer(TASK, "machine-conforme", respond(409, { error: { code: "SUMMARY_DESIGNATED", message: "x" } })), { kind: "failed" });
  const failed = section({ confirmedVersion: 1, message: fr.conformity.failed });
  assert.ok(decode(failed).includes("La décision n’a pas pu être enregistrée."));
  assert.equal(buttons(failed).length, 2, "no decision is claimed: the buttons stay");
});

test("W48 historical decisions are listed read only, newest first; a current decision after reconfirmation shows beside them", () => {
  const history = [historyItem({ id: "b", outcome: "machine-non-conforme", summaryVersion: 2 }), historyItem({ id: "a", summaryVersion: 1 })];
  const markup = section({ confirmedVersion: 3, decision: decision({ summaryVersion: 3 }), history });
  const text = decode(markup);
  assert.ok(text.includes(fr.conformity.historyHeading));
  const first = text.indexOf("Machine non conforme — synthèse version 2 remplacée — par Responsable Test le ");
  const second = text.indexOf("Machine conforme — synthèse version 1 remplacée — par Responsable Test le ");
  assert.ok(first >= 0 && second > first, text);
  assert.deepEqual(buttons(markup), []);
  assert.ok(text.includes("Décision : Machine conforme"));
  const open = section({ confirmedVersion: null, history });
  assert.ok(decode(open).includes(fr.conformity.historyHeading));
  assert.deepEqual(buttons(open), []);
  assert.ok(!decode(section({ confirmedVersion: 1 })).includes(fr.conformity.historyHeading));
});

test("W49 no report control, no English text, and markup in names is shown as text", () => {
  const raw = "<b>gras</b> & <script>x</script>";
  const markups = [
    section({}), section({ confirmedVersion: 1 }), section({ confirmedVersion: 1, prompt: "machine-conforme" }), section({ confirmedVersion: 1, message: fr.conformity.alreadyDecided }),
    section({ confirmedVersion: 1, decision: decision({ decidedBy: { id: USER, displayName: raw } }), history: [historyItem({ decidedBy: { id: USER, displayName: raw } })] }),
  ];
  const english = /(?<!\p{L})(save|approve|conformity|decision|report|confirm|loading|summary)(?!\p{L})/iu;
  for (const markup of markups) {
    assert.ok(!markup.includes("<b>gras") && !markup.includes("<script>"));
    const text = decode(markup).replaceAll(raw, "");
    assert.ok(!/Rapport|Word|PDF|Conclusion générale/.test(text), text);
    assert.ok(!english.test(text), text);
  }
});

test("W49 the evidence panel shows the decision area from the server state and ignores insights and verdicts", () => {
  const confirmed = { id: ID, version: 1, text: "Synthèse.", confirmedAt: "2026-10-08T10:00:00.000Z", confirmedBy: { id: USER, displayName: "Responsable Test" }, summaryInputSetId: "b".repeat(64), initialDraft: null };
  const panel = (props: Record<string, unknown>) => renderToStaticMarkup(<InsightProposalsPanel taskId={TASK} insights={{ status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] }} initialDecisions={[]} {...props} />);
  const open = decode(panel({}));
  assert.ok(open.includes(fr.conformity.awaitingSummary) && !open.includes(fr.conformity.conforme));
  const ready = panel({ initialSummary: confirmed });
  assert.ok(decode(ready).includes(fr.conformity.heading));
  assert.deepEqual(buttons(ready).filter((button) => ([fr.conformity.conforme, fr.conformity.nonConforme] as string[]).includes(button.label)).length, 2);
  const decided = decode(panel({ initialSummary: confirmed, initialConformityDecision: decision(), initialConformityHistory: [historyItem({ id: "old" })] }));
  assert.ok(decided.includes("Décision : Machine conforme") && decided.includes(fr.conformity.historyHeading));
});
