import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GRAPHIE_CALCULATION_IDENTITY, calculateGraphieResults } from "@cetem-qc/domain";
import type { CalculationContext } from "@cetem-qc/domain";
import type { AcceptedEvidenceResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { AcceptedEvidenceView, InsightProposalsSection, ManualInsightsSection, loadAcceptedEvidence, submitInsightDecision, submitManualInsight } from "./accepted-evidence";
import { SummaryDraftSection, applyDraft, confirmSummaryOnServer, requestSummaryDraftFromServer } from "./summary-draft";
import type { EvidenceLoad } from "./accepted-evidence";
import { TaskListView } from "./task-list";
import type { TaskListViewProps } from "./task-list";

// Story 9.1 (W2–W7): read-only W4 evidence panel; synthetic names only.
// The web tsconfig keeps Next's `jsx: preserve`, so tsx compiles JSX with the classic runtime.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const TASK = "00000000-0000-4000-8000-000000000201";
const DRAFT = "00000000-0000-4000-8000-000000000202";
const OTHER = "00000000-0000-4000-8000-000000000203";
const noop = () => undefined;

const values: Record<string, string> = {
  "header.reportNumber": "R-091",
  "header.etablissement": "  Centre A  ",
  "equipment.tube.brand": "Marque T",
  "visual.integrity": "Oui",
  "comments.general": "Ligne 1\nLigne 2",
  "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2",
  "voltage.repeatability.row1.kvMeasured": "69,7", "voltage.repeatability.row1.kerma": "2,677",
};

const evidenceFor = (identity: CalculationContext = GRAPHIE_CALCULATION_IDENTITY, overrides: Partial<AcceptedEvidenceResponse> = {}, stored: Record<string, string> = values): AcceptedEvidenceResponse => ({
  task: { id: TASK, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" },
  submission: { submissionId: OTHER, auditId: OTHER, revision: 2, submittedBy: { id: OTHER, displayName: "Employé Test" }, acceptedAt: "2026-10-07T08:30:00.000Z" },
  identity, values: stored, results: calculateGraphieResults(identity, stored) as unknown as AcceptedEvidenceResponse["results"],
  lineage: { replacementOf: DRAFT, replacedBy: null, recoverySource: null, recoverySuccessorTaskId: null },
  insights: { status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] },
  insightDecisions: [],
  manualInsights: [],
  summary: null,
  summaryHistory: [],
  summaryVersion: { number: 1, state: "open" },
  conformityDecision: null,
  conformityHistory: [],
  ...overrides,
});

const view = (load: EvidenceLoad | undefined, handlers: { onBack?: () => void; onRetry?: () => void } = {}) =>
  renderToStaticMarkup(<AcceptedEvidenceView taskId={TASK} load={load} onBack={handlers.onBack ?? noop} onRetry={handlers.onRetry ?? noop} />);
const ready = (evidence = evidenceFor()): EvidenceLoad => ({ kind: "ready", evidence });
const decode = (markup: string) => markup.replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", "\"").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

type Task = TaskListViewProps["tasks"][number];
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, type: "graphie_mobile", establishment: `Centre ${id.slice(-3)}`, assignee: "Employé Test",
  assigneeActive: true, assignmentVersion: 1, assignmentHistory: [], recoveryState: null, recoveryRevision: null,
  recoverySource: null, recoverySuccessorTaskId: null,
  state: "draft", lastUpdatedAt: "2026-10-05T10:00:00.000Z", replacementOf: null, replacedBy: null, ...overrides,
});
const listProps = (overrides: Partial<TaskListViewProps> = {}): TaskListViewProps => ({
  tasks: [], loading: false, error: false, onRetry: noop, onReplace: noop, onCancelReplacement: noop, onReplacementCreated: noop, onStale: noop, ...overrides,
});

function stubFetch(status: number, body: unknown, calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => { calls.push(String(url)); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
}

test("W2 « Consulter les preuves » appears only on submitted rows, with aria-expanded", () => {
  const tasks = [task(TASK, { state: "submitted" }), task(DRAFT)];
  const html = renderToStaticMarkup(<TaskListView {...listProps({ tasks, onViewEvidence: noop })} />);
  assert.equal(html.split("Consulter les preuves").length - 1, 1);
  const button = html.match(/<button[^>]*id="evidence-button-[^"]+"[^>]*>/)![0];
  assert.match(button, new RegExp(`id="evidence-button-${TASK}"`));
  assert.match(button, /aria-expanded="false"/);
  const open = renderToStaticMarkup(<TaskListView {...listProps({ tasks, onViewEvidence: noop, evidenceTaskId: TASK, evidencePanel: <p>panneau</p> })} />);
  assert.match(open.match(/<button[^>]*id="evidence-button-[^"]+"[^>]*>/)![0], /aria-expanded="true"/);
  assert.match(open, /panneau/);
  // Without the optional prop the list is unchanged.
  assert.ok(!renderToStaticMarkup(<TaskListView {...listProps({ tasks })} />).includes("Consulter les preuves"));
});

test("W3 the panel shows loading, then context, lineage, stored data, the 6.4 review with its single note, and the back control", () => {
  assert.match(view(undefined), /role="status">Chargement…/);
  const html = view(ready());
  const text = decode(html);
  assert.match(html, /<h2 id="evidence-heading" tabindex="-1">Preuves de l’audit/);
  assert.match(text, new RegExp(`Identifiant de la tâche : ${TASK}`));
  assert.match(text, /Établissement A · Radiologie · Employé Test · Soumis par Employé Test · Accepté le .*2026.* · Révision 2/);
  assert.match(text, new RegExp(`Remplacement de l’audit ${DRAFT}`));
  assert.match(text, /Données saisies/);
  assert.match(text, /N° rapport\s+R-091/);
  assert.match(text, /Non renseigné/);
  assert.match(html, /<section class="calculation-review"/);
  assert.equal(html.split("la conformité finale de l&#x27;appareil est décidée par le Responsable").length - 1, 1, "the decision note appears once");
  assert.match(html, /Retour à la liste/);
  // Calculation inputs are shown by the review, not duplicated in the stored-data block.
  const inputBlock = html.slice(html.indexOf('class="evidence-inputs"'), html.indexOf('<section class="calculation-review"'));
  assert.ok(!inputBlock.includes("49,2") && !inputBlock.includes("2,677"));
  assert.match(inputBlock, /Marque T/);
  assert.match(html, /49,2/);
});

test("W3 the back control calls the close handler", () => {
  let closed = 0;
  const tree = AcceptedEvidenceView({ taskId: TASK, load: ready(), onBack: () => { closed++; }, onRetry: noop });
  type Node = React.ReactElement<{ onClick?: () => void; children?: React.ReactNode }>;
  const buttons: Node[] = [];
  const walk = (node: React.ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!React.isValidElement(node)) return;
    const element = node as Node;
    if (element.type === "button") buttons.push(element);
    walk(element.props.children);
  };
  walk(tree);
  assert.equal(buttons.length, 1);
  buttons[0]!.props.onClick?.();
  assert.equal(closed, 1);
});

test("W4 the panel holds no input, textarea, select, form, or button besides « Retour à la liste », and no approval wording", () => {
  // Story 9.4 adds the manual-insight form to the insights area; everything outside that section stays control-free.
  const html = view(ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { lineage: { replacementOf: null, replacedBy: DRAFT, recoverySource: null, recoverySuccessorTaskId: null } })))
    .replace(/<section class="evidence-manual-insights"[\s\S]*?<\/form><\/section>/, "")
    // Story 10.1 adds the summary block (one request button, one text area, no form); it is covered by W24–W28.
    .replace(/<section class="evidence-summary"[\s\S]*?<\/section>/, "");
  for (const tag of ["input", "textarea", "select", "form"]) assert.ok(!new RegExp(`<${tag}\\b`).test(html), tag);
  const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) => decode(match[1]!).trim());
  assert.deepEqual(buttons, ["Retour à la liste"]);
  assert.ok(!html.includes("dangerouslySetInnerHTML"));
  for (const word of ["Approuver", "Rejeter", "Valider", "Machine conforme", "examiné"]) assert.ok(!html.includes(word), word);
});

test("W5 a 404, 403, 500 and a network failure each show their text, and « Réessayer » sends one new request", async () => {
  const cases: Array<[number | "network", unknown, EvidenceLoad["kind"], RegExp]> = [
    [404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }, "not-found", /Ces preuves ne sont pas disponibles\. Actualisez la liste\./],
    [403, { error: { code: "FORBIDDEN", message: "x" } }, "forbidden", /Cet espace est réservé aux Responsables\./],
    [500, { error: { code: "INTERNAL_ERROR", message: "x" } }, "failed", /Les preuves n’ont pas pu être chargées\./],
    ["network", undefined, "unavailable", /Le service est momentanément indisponible\./],
  ];
  for (const [status, body, kind, text] of cases) {
    const calls: string[] = [];
    const fetcher = status === "network" ? (async () => { calls.push("x"); throw new TypeError("network"); }) as typeof fetch : stubFetch(status, body, calls);
    const load = await loadAcceptedEvidence(TASK, fetcher);
    assert.equal(load.kind, kind);
    assert.equal(calls.length, 1);
    const html = view(load);
    assert.match(decode(html), text);
    if (kind === "not-found" || kind === "forbidden") {
      assert.ok(!html.includes("Réessayer"));
    } else {
      assert.match(html, /Réessayer/);
      await loadAcceptedEvidence(TASK, fetcher);
      assert.equal(calls.length, 2, "a retry is one new request");
    }
  }
  const calls: string[] = [];
  assert.equal((await loadAcceptedEvidence(TASK, stubFetch(200, { not: "evidence" }, calls))).kind, "failed");
  assert.match(calls[0]!, new RegExp(`^/api/tasks/${TASK}/accepted-evidence$`));
});

test("W5 the retry control calls the retry handler once", () => {
  let retries = 0;
  const tree = AcceptedEvidenceView({ taskId: TASK, load: { kind: "failed" }, onBack: noop, onRetry: () => { retries++; } });
  type Node = React.ReactElement<{ onClick?: () => void; children?: React.ReactNode }>;
  const retry: Node[] = [];
  const walk = (node: React.ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!React.isValidElement(node)) return;
    const element = node as Node;
    if (element.type === "button" && element.props.children === "Réessayer") retry.push(element);
    walk(element.props.children);
  };
  walk(tree);
  assert.equal(retry.length, 1);
  retry[0]!.props.onClick?.();
  assert.equal(retries, 1);
});

test("W5 a valid 200 body is parsed into the ready state", async () => {
  const load = await loadAcceptedEvidence(TASK, stubFetch(200, evidenceFor()));
  assert.equal(load.kind, "ready");
});

test("W6 an unsupported identity shows the alert and the stored identity, no verdict, and still shows the stored data", () => {
  const old: CalculationContext = { ...GRAPHIE_CALCULATION_IDENTITY, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" };
  const html = view(ready(evidenceFor(old)));
  const text = decode(html);
  assert.match(html, /role="alert"/);
  assert.match(text, /Version de règle non prise en charge — aucun calcul/);
  assert.match(text, /cetem-workbook-explicit-formulas 1\.0\.0/);
  assert.ok(!html.includes("calculation-verdict"));
  assert.match(text, /Données saisies/);
  assert.match(text, /R-091/);
  assert.match(text, /49,2/, "measured values still show");
});

test("W7 a stored value containing HTML renders as text, and line breaks and spaces are kept", () => {
  const html = view(ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, {}, { ...values, "comments.general": "<b>x</b>\n  <script>alert(1)</script>" })));
  assert.ok(!html.includes("<b>x</b>") && !html.includes("<script>"));
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;\n {2}&lt;script&gt;/);
  assert.match(html, /class="evidence-value"/);
});

// Story 9.2 (W8–W12): read-only insight proposals section.
const UNAVAILABLE_TEXT = "Propositions d’insights indisponibles : aucune règle CETEM approuvée.";
const insightSection = (markup: string) => /<section class="evidence-insights"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";
const proposal = (ruleId: string, statement: string, sourceKeys: Array<{ kind: "field" | "result"; key: string }>) => ({
  proposalId: `${ruleId}:v1:${OTHER}:x`, ruleId, ruleVersion: 1, approvalReference: "Document synthétique 2026", registryVersion: "insight-registry-1",
  submissionId: OTHER, sourceKeys, statement, origin: "deterministic" as const,
});
const availableWith = (proposals: ReturnType<typeof proposal>[]) => ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { insights: { status: "available", registryVersion: "insight-registry-1", proposals } }));

test("W8 unavailable insights show the message once and no insight or decision control", () => {
  const markup = view(ready());
  assert.equal(decode(markup).split(UNAVAILABLE_TEXT).length - 1, 1);
  const section = insightSection(markup);
  assert.ok(!section.includes("<li") && !section.includes("<button"));
  assert.ok(!/approuver|rejeter|conserver|écarter|retenir/i.test(decode(section).replace(UNAVAILABLE_TEXT, "")));
});

test("W9 available with zero proposals shows « aucune observation »", () => {
  const markup = view(availableWith([]));
  assert.match(decode(insightSection(markup)), /Aucune observation proposée par les règles approuvées\./);
  assert.ok(!markup.includes(UNAVAILABLE_TEXT.replace("’", "&#x27;")) && !decode(markup).includes(UNAVAILABLE_TEXT));
});

test("W10 available proposals are shown with rule, approval and source labels; Story 9.3 adds only the two decision buttons; the conformity note appears once", () => {
  const markup = view(availableWith([
    proposal("regle-a", "Observation A.", [{ kind: "field", key: "header.reportNumber" }]),
    proposal("regle-b", "Observation B.", [{ kind: "result", key: "voltageAccuracy" }]),
  ]));
  const section = decode(insightSection(markup));
  for (const expected of ["Observation A.", "Règle regle-a v1", "Règle regle-b v1", "Document synthétique 2026", "Exactitude de la tension"]) assert.ok(section.includes(expected), expected);
  assert.equal(insightSection(markup).split("<button").length - 1, 4, "two buttons per proposal");
  assert.ok(!insightSection(markup).includes("<input"));
  assert.equal(decode(markup).split("la conformité finale de l'appareil est décidée par le Responsable").length - 1, 1);
});

test("W11 the component renders a statement as received and never evaluates", () => {
  const markup = view(availableWith([proposal("regle-inconnue", "Texte libre non issu d’un modèle.", [{ kind: "field", key: "header.reportNumber" }])]));
  assert.ok(decode(insightSection(markup)).includes("Texte libre non issu d’un modèle."));
});

test("W12 the insight strings are French and the section has no English text", () => {
  const strings = [fr.insights.heading, fr.insights.unavailable, fr.insights.none, fr.insights.rule, fr.insights.approval, fr.insights.sources];
  for (const text of strings) assert.ok(text.trim() !== "");
  const text = decode(insightSection(view(ready())));
  assert.ok(!/\b(insights? unavailable|no approved|retain|discard|approve|reject)\b/i.test(text));
});

// Story 9.3 (W13–W16): retain/discard controls.
const decisionOf = (proposalId: string, decision: "retained" | "discarded") => ({
  proposalId, decision, decidedAt: "2026-10-08T09:00:00.000Z", decidedBy: { id: OTHER, displayName: "Responsable Test" },
  registryVersion: "insight-registry-1", ruleId: "regle-a", ruleVersion: 1,
});
const proposalA = () => proposal("regle-a", "Observation A.", [{ kind: "field", key: "header.reportNumber" }]);
const proposalB = () => proposal("regle-b", "Observation B.", [{ kind: "result", key: "voltageAccuracy" }]);
const withDecisions = (decisions: ReturnType<typeof decisionOf>[]) =>
  ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { insights: { status: "available", registryVersion: "insight-registry-1", proposals: [proposalA(), proposalB()] }, insightDecisions: decisions }));

test("W13 available proposals render the two buttons, the state and the decider; unavailable and zero-proposal states render no control", () => {
  const a = proposalA();
  const markup = view(withDecisions([decisionOf(a.proposalId, "retained")]));
  const section = insightSection(markup);
  assert.equal(section.split("<button").length - 1, 4);
  const text = decode(section);
  for (const expected of ["Retenir", "Écarter", "Retenu", "Non décidé", "Décidé par Responsable Test le"]) assert.ok(text.includes(expected), expected);
  assert.equal(section.split('aria-pressed="true"').length - 1, 1);
  assert.ok(!insightSection(view(ready())).includes("<button"));
  assert.ok(!insightSection(view(availableWith([]))).includes("<button"));
});

test("W14 « Aucun insight retenu » shows when nothing is retained and is not a warning", () => {
  const a = proposalA();
  for (const decisions of [[], [decisionOf(a.proposalId, "discarded")]]) {
    const section = insightSection(view(withDecisions(decisions)));
    assert.ok(decode(section).includes("Aucun insight retenu"));
    assert.ok(!/role="alert"|error-state|field-error/.test(section));
  }
  assert.ok(!decode(insightSection(view(withDecisions([decisionOf(a.proposalId, "retained")])))).includes("Aucun insight retenu"));
});

test("W15 submitInsightDecision calls the handler once, parses the response, and reports a failure without throwing", async () => {
  const a = proposalA();
  const calls: Array<{ url: string; body: unknown }> = [];
  const okFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body });
    return new Response(JSON.stringify({ proposalId: a.proposalId, decision: "retained", decidedAt: "2026-10-08T09:00:00.000Z", decidedBy: { id: OTHER, displayName: "Responsable Test" } }), { status: 200 });
  }) as typeof fetch;
  const result = await submitInsightDecision(TASK, a.proposalId, "retained", okFetch);
  assert.equal(result.kind, "recorded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, `/api/tasks/${TASK}/insight-decisions`);
  assert.deepEqual(JSON.parse(String(calls[0]!.body)), { proposalId: a.proposalId, decision: "retained" });
  for (const status of [403, 404, 422, 500, 503]) assert.deepEqual(await submitInsightDecision(TASK, a.proposalId, "retained", stubFetch(status, {})), { kind: "failed" });
  assert.deepEqual(await submitInsightDecision(TASK, a.proposalId, "retained", (async () => { throw new Error("offline"); }) as typeof fetch), { kind: "failed" });
  assert.deepEqual(await submitInsightDecision(TASK, a.proposalId, "retained", stubFetch(200, { unexpected: true })), { kind: "failed" });
});

test("W15 the section disables both buttons of the pending proposal and shows the French error with the state unchanged", () => {
  const a = proposalA();
  const insights = { status: "available" as const, registryVersion: "insight-registry-1", proposals: [a, proposalB()] };
  const pendingMarkup = renderToStaticMarkup(<InsightProposalsSection insights={insights} decisions={[]} pendingProposalId={a.proposalId} onDecide={noop} />);
  assert.equal(pendingMarkup.split("disabled").length - 1, 2);
  const failedMarkup = renderToStaticMarkup(<InsightProposalsSection insights={insights} decisions={[decisionOf(a.proposalId, "discarded")]} failed onDecide={noop} />);
  assert.ok(decode(failedMarkup).includes(fr.insights.decisionFailed));
  assert.ok(decode(failedMarkup).includes("Écarté"));
});

test("W16 no approve, reject or conformity wording is added; the conformity note appears once; no English text", () => {
  const a = proposalA();
  const markup = view(withDecisions([decisionOf(a.proposalId, "retained")]));
  const text = decode(insightSection(markup));
  assert.ok(!/approuv|rejet|rejeter|conforme|non conforme|\b(retain|discard|approve|reject|undecided)\b/i.test(text));
  assert.equal(decode(markup).split("la conformité finale de l'appareil est décidée par le Responsable").length - 1, 1);
});

// Story 9.4 (W18–W22): manual insights in the W5 panel.
const manualSection = (markup: string) => /<section class="evidence-manual-insights"[\s\S]*?<\/form><\/section>/.exec(markup)?.[0] ?? "";
const manualInsightOf = (id: string, text: string, justification: string | null = null) => ({
  id, text, justification, sourceType: "manual" as const, createdAt: "2026-10-08T09:00:00.000Z", author: { id: OTHER, displayName: "Responsable Test" },
});

test("W18 the add form renders whether proposals are available, unavailable or empty; labels are associated; no file input", () => {
  const states = [
    { status: "unavailable" as const, reason: "no-approved-rules" as const, registryVersion: "insight-registry-1", proposals: [] },
    { status: "available" as const, registryVersion: "insight-registry-1", proposals: [] },
    { status: "available" as const, registryVersion: "insight-registry-1", proposals: [proposalA()] },
  ];
  for (const insights of states) {
    const section = manualSection(view(ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { insights }))));
    assert.ok(section.includes(fr.insights.manualFormHeading));
    assert.match(section, /<label for="manual-insight-text">/);
    assert.match(section, /<textarea id="manual-insight-text"[^>]*required=""[^>]*maxLength="1000"|<textarea id="manual-insight-text"[^>]*maxLength="1000"[^>]*required=""/);
    assert.match(section, /<label for="manual-insight-justification">/);
    assert.ok(decode(section).includes("Justification"));
    assert.ok(decode(section).includes(fr.insights.manualSubmit));
    assert.ok(!section.includes("type=\"file\""));
  }
});

test("W19 manual insights render text, justification, label, author and date; no edit or delete; markup is shown as text", () => {
  const evidence = evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { manualInsights: [manualInsightOf(DRAFT, "<script>alert(1)</script> Fuite", "Vu sur place"), manualInsightOf(OTHER, "Deuxième")] });
  const section = manualSection(view(ready(evidence)));
  assert.ok(!section.includes("<script>"));
  const text = decode(section);
  assert.ok(text.includes("<script>alert(1)</script> Fuite"));
  assert.ok(text.includes("Justification : Vu sur place"));
  assert.equal(text.split(fr.insights.manualLabel).length - 1, 2);
  assert.ok(text.includes("Ajouté par Responsable Test le "));
  assert.ok(!/modifier|supprimer|éditer/i.test(text));
  assert.equal(section.split("<button").length - 1, 1, "only the submit button");
});

test("W20 « Aucun insight retenu » shows only when no proposal is retained and no manual insight exists, and is not a warning", () => {
  const insights = { status: "available" as const, registryVersion: "insight-registry-1", proposals: [proposalA()] };
  const without = renderToStaticMarkup(<InsightProposalsSection insights={insights} decisions={[]} />);
  assert.ok(decode(without).includes(fr.insights.noneRetained));
  assert.ok(!/role="alert"/.test(without.slice(without.indexOf(fr.insights.noneRetained) - 120, without.indexOf(fr.insights.noneRetained))));
  const withManual = renderToStaticMarkup(<InsightProposalsSection insights={insights} decisions={[]} manualInsightCount={1} />);
  assert.ok(!decode(withManual).includes(fr.insights.noneRetained));
});

test("W21 submitManualInsight calls the handler once, parses the 201 response and reports failures without throwing", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const created = manualInsightOf(DRAFT, "Observation", "Preuve");
  const okFetch = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: init?.body }); return new Response(JSON.stringify(created), { status: 201 }); }) as typeof fetch;
  const result = await submitManualInsight(TASK, "Observation", "Preuve", okFetch);
  assert.deepEqual(result, { kind: "added", insight: created });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, `/api/tasks/${TASK}/manual-insights`);
  assert.deepEqual(JSON.parse(String(calls[0]!.body)), { text: "Observation", justification: "Preuve" });
  await submitManualInsight(TASK, "Observation", "   ", okFetch);
  assert.deepEqual(JSON.parse(String(calls[1]!.body)), { text: "Observation" });
  for (const status of [200, 403, 404, 422, 500, 503]) assert.deepEqual(await submitManualInsight(TASK, "x", "", stubFetch(status, {})), { kind: "failed" });
  assert.deepEqual(await submitManualInsight(TASK, "x", "", (async () => { throw new Error("offline"); }) as typeof fetch), { kind: "failed" });
  assert.deepEqual(await submitManualInsight(TASK, "x", "", stubFetch(201, { unexpected: true })), { kind: "failed" });
});

test("W21 the section disables submit while pending and shows the French error with the list unchanged", () => {
  const items = [manualInsightOf(DRAFT, "Existant")];
  const pending = renderToStaticMarkup(<ManualInsightsSection insights={items} pending onAdd={() => true} />);
  assert.match(pending, /<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
  const failed = renderToStaticMarkup(<ManualInsightsSection insights={items} failed onAdd={() => false} />);
  assert.ok(decode(failed).includes(fr.insights.manualFailed));
  assert.ok(decode(failed).includes("Existant"));
});

test("W22 no approve, reject or conformity wording in the manual section; the conformity note appears once; no English text", () => {
  const markup = view(ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { manualInsights: [manualInsightOf(DRAFT, "Observation")] })));
  const text = decode(manualSection(markup));
  assert.ok(!/approuv|rejet|rejeter|conforme|non conforme|\b(approve|reject|submit|delete|edit|added|author)\b/i.test(text.replace(fr.insights.manualHint, "")));
  assert.equal(decode(markup).split("la conformité finale de l'appareil est décidée par le Responsable").length - 1, 1);
});

// Story 10.1 (W24–W28): AI summary draft block in the W5 panel.
const summaryDraft = (text = "Brouillon IA.") => ({
  id: DRAFT, status: "generated" as const, text, provider: "mock", model: "mock-fixed-text", requestedAt: "2026-10-08T09:00:00.000Z",
  requestedBy: { id: OTHER, displayName: "Responsable Test" }, summaryInputSetId: "a".repeat(64),
});
const summaryBlock = (markup: string) => /<section class="evidence-summary"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";

test("W24 the summary block, note, button and always-editable text area render for every accepted audit", () => {
  const available = ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { insights: { status: "available", registryVersion: "insight-registry-1", proposals: [proposalA()] } }));
  const empty = ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { insights: { status: "available", registryVersion: "insight-registry-1", proposals: [] } }));
  for (const load of [ready(), available, empty]) {
    const block = summaryBlock(view(load));
    const text = decode(block);
    for (const label of [fr.summary.heading, fr.summary.note, fr.summary.request, fr.summary.textLabel]) assert.ok(text.includes(label), label);
    assert.match(block, /<textarea id="summary-text"/);
    assert.ok(!/<textarea[^>]*(disabled|readonly)/i.test(block));
    assert.match(block, /<label for="summary-text">/);
  }
});

test("W25 pending shows the loading text, disables the button and sets aria-busy; a filled draft is labelled unconfirmed with provider, model and date", () => {
  const pending = summaryBlock(renderToStaticMarkup(<SummaryDraftSection text="" pending onRequest={noop} />));
  assert.ok(decode(pending).includes(fr.summary.pending));
  assert.match(pending, /<button[^>]*aria-busy="true"[^>]*>/);
  assert.match(pending, /<button[^>]*disabled=""[^>]*>/);
  const idle = summaryBlock(renderToStaticMarkup(<SummaryDraftSection text="" onRequest={noop} />));
  // The confirm button is disabled for empty text; only the request button is checked here.
  assert.ok(!/disabled=""/.test(idle.replace(/<button[^>]*primary-button[^>]*>[\s\S]*?<\/button>/, "")) && !decode(idle).includes(fr.summary.pending));
  const draft = summaryDraft();
  const filled = decode(summaryBlock(renderToStaticMarkup(<SummaryDraftSection text={draft.text} filled={draft} onRequest={noop} />)));
  assert.ok(filled.includes(fr.summary.draftLabel) && filled.includes("Fournisseur mock, modèle mock-fixed-text"));
  assert.deepEqual(applyDraft("", draft), { text: "Brouillon IA.", offered: null });
  assert.deepEqual(applyDraft("  \n ", draft), { text: "Brouillon IA.", offered: null });
});

test("W26 with typed text a new draft is offered in a separate block and only replaces the text through the replace button", () => {
  const draft = summaryDraft("Nouveau texte.");
  assert.deepEqual(applyDraft("Mon texte.", draft), { text: "Mon texte.", offered: draft });
  const markup = renderToStaticMarkup(<SummaryDraftSection text="Mon texte." offered={draft} onRequest={noop} onReplace={noop} />);
  assert.match(markup, /<textarea[^>]*>Mon texte\.<\/textarea>/);
  const text = decode(summaryBlock(markup));
  assert.ok(text.includes(fr.summary.newDraftHeading) && text.includes("Nouveau texte.") && text.includes(fr.summary.replace));
});

test("W27 a failure shows the French alert, keeps the typed text and leaves the retry button enabled; requests fail soft", async () => {
  const markup = summaryBlock(renderToStaticMarkup(<SummaryDraftSection text="Mon texte." failed onRequest={noop} />));
  assert.match(markup, /role="alert"/);
  assert.ok(decode(markup).includes("Le brouillon IA n’est pas disponible. Réessayez ou rédigez la synthèse manuellement."));
  assert.match(markup, /<textarea[^>]*>Mon texte\.<\/textarea>/);
  assert.ok(!/disabled=""/.test(markup));
  const calls: Array<{ url: string; body: unknown }> = [];
  const created = summaryDraft();
  const okFetch = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: init?.body }); return new Response(JSON.stringify(created), { status: 201 }); }) as typeof fetch;
  assert.deepEqual(await requestSummaryDraftFromServer(TASK, okFetch), { kind: "generated", draft: created });
  assert.equal(calls[0]!.url, `/api/tasks/${TASK}/summary-drafts`);
  assert.equal(calls[0]!.body, "{}");
  for (const status of [200, 403, 404, 422, 500, 502, 503]) assert.deepEqual(await requestSummaryDraftFromServer(TASK, stubFetch(status, {})), { kind: "failed" });
  assert.deepEqual(await requestSummaryDraftFromServer(TASK, (async () => { throw new Error("offline"); }) as typeof fetch), { kind: "failed" });
  assert.deepEqual(await requestSummaryDraftFromServer(TASK, stubFetch(201, { ...created, status: "confirmed" })), { kind: "failed" });
});

test("W28 the block has no save, conformity or approval control or wording (Story 10.2 adds only the confirm control), no English text, and draft markup is shown as text", () => {
  const draft = summaryDraft("<b>gras</b> & <script>x</script>");
  const markup = summaryBlock(renderToStaticMarkup(<SummaryDraftSection text="Mon texte." filled={draft} offered={draft} onRequest={noop} onReplace={noop} />));
  assert.ok(!markup.includes("<b>gras") && !markup.includes("<script>"));
  const text = decode(markup);
  assert.ok(text.includes("<b>gras</b>"));
  const withoutNote = text.replace(fr.summary.note, "").replace(fr.summary.conformityUnavailable, "").replace(fr.summary.confirm, "");
  assert.ok(!/enregistrer|confirmer|confirmation|approuv|conforme|valider|verrouill/i.test(withoutNote), withoutNote);
  assert.ok(!/\b(save|approve|conformity|draft|summary|request|loading)\b/i.test(text.replace(draft.text, "")));
  assert.deepEqual([...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]), [fr.summary.request, fr.summary.replace, fr.summary.confirm]);
  assert.equal(decode(view(ready())).split("la conformité finale de l'appareil est décidée par le Responsable").length - 1, 1);
});

// Story 10.2 (W30–W35): explicit confirmation and the confirmed read-only state.
const SUMMARY_ID = "00000000-0000-4000-8000-000000000204";
const confirmed = (overrides: Partial<NonNullable<AcceptedEvidenceResponse["summary"]>> = {}): NonNullable<AcceptedEvidenceResponse["summary"]> => ({
  id: SUMMARY_ID, version: 1, text: "Synthèse finale.", confirmedAt: "2026-10-08T10:00:00.000Z", confirmedBy: { id: OTHER, displayName: "Responsable Test" },
  summaryInputSetId: "b".repeat(64), initialDraft: null, ...overrides,
});
const initialDraft = () => ({ id: DRAFT, text: "Brouillon initial.", provider: "mock", model: "mock-fixed-text", requestedAt: "2026-10-08T09:00:00.000Z", summaryInputSetId: "a".repeat(64) });
const section = (props: Partial<React.ComponentProps<typeof SummaryDraftSection>>) => renderToStaticMarkup(<SummaryDraftSection text="" {...props} />);
const confirmButton = (markup: string) => new RegExp(`<button[^>]*class="primary-button"[^>]*>${fr.summary.confirm}</button>`).exec(markup)?.[0] ?? "";

test("W30 « Confirmer la synthèse » is disabled for empty or whitespace text and while pending, enabled otherwise", () => {
  for (const text of ["", "  \n "]) assert.match(confirmButton(section({ text })), /disabled=""/);
  assert.match(confirmButton(section({ text: "Texte.", pending: true })), /disabled=""/);
  assert.match(confirmButton(section({ text: "Texte.", confirmPending: true })), /disabled=""/);
  const enabled = confirmButton(section({ text: "Texte." }));
  assert.ok(enabled !== "" && !/disabled=""/.test(enabled));
  assert.ok(confirmButton(section({ text: "Brouillon.", filled: summaryDraft() })) !== "");
});

test("W31 the prompt offers « Confirmer » and « Annuler » with the French question; the confirm button is replaced by it", () => {
  const markup = section({ text: "Texte.", confirming: true });
  const text = decode(markup);
  assert.ok(text.includes(fr.summary.confirmPrompt) && text.includes(fr.summary.confirmYes) && text.includes(fr.summary.confirmCancel));
  assert.equal(confirmButton(markup), "");
  assert.ok(!decode(section({ text: "Texte." })).includes(fr.summary.confirmPrompt));
});

test("W31 the confirmation request sends the draft link only for AI-started text", async () => {
  const bodies: unknown[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify(confirmed()), { status: 201 }); }) as typeof fetch;
  assert.deepEqual(await confirmSummaryOnServer(TASK, "Texte.", DRAFT, fetcher), { kind: "confirmed", summary: confirmed() });
  assert.deepEqual(await confirmSummaryOnServer(TASK, "Texte.", null, fetcher), { kind: "confirmed", summary: confirmed() });
  assert.deepEqual(bodies, [{ text: "Texte.", draftId: DRAFT }, { text: "Texte." }]);
});

test("W32 the confirmed state is read only with the confirmer, the date and the initial draft block only when present", () => {
  const manual = section({ summary: confirmed() });
  const text = decode(manual);
  assert.ok(text.includes(fr.summary.confirmedHeading) && text.includes("Confirmée par Responsable Test le "));
  assert.match(manual, /<textarea[^>]*readOnly=""[^>]*>Synthèse finale\.<\/textarea>/i);
  assert.ok(!text.includes(fr.summary.initialDraftLabel) && !/mock/.test(text));
  assert.equal(confirmButton(manual), "");
  const withDraft = decode(section({ summary: confirmed({ initialDraft: initialDraft() }) }));
  assert.ok(withDraft.includes(fr.summary.initialDraftLabel) && withDraft.includes("Brouillon initial.") && withDraft.includes("Fournisseur mock, modèle mock-fixed-text"));
  assert.ok(!withDraft.includes(fr.summary.conformityUnavailable));
});

test("W33 a failed confirmation shows the French failure, keeps the text and no confirmed state; a 409 is reported for reload", async () => {
  const markup = section({ text: "Mon texte.", confirmFailed: true });
  assert.ok(decode(markup).includes(fr.summary.confirmFailed) && !decode(markup).includes(fr.summary.confirmedHeading));
  assert.match(markup, /<textarea[^>]*>Mon texte\.<\/textarea>/);
  assert.ok(confirmButton(markup) !== "" && !/disabled=""/.test(confirmButton(markup)));
  for (const status of [200, 403, 404, 422, 500, 503]) assert.deepEqual(await confirmSummaryOnServer(TASK, "T", null, stubFetch(status, {})), { kind: "failed" });
  assert.deepEqual(await confirmSummaryOnServer(TASK, "T", null, (async () => { throw new Error("offline"); }) as typeof fetch), { kind: "failed" });
  assert.deepEqual(await confirmSummaryOnServer(TASK, "T", null, stubFetch(201, { ...confirmed(), summaryInputSetId: "x" })), { kind: "failed" });
  for (const code of ["SUMMARY_ALREADY_CONFIRMED", "SUMMARY_CONFIRMED"]) assert.deepEqual(await confirmSummaryOnServer(TASK, "T", null, stubFetch(409, { error: { code, message: "m" } })), { kind: "already-confirmed" });
  assert.deepEqual(await confirmSummaryOnServer(TASK, "T", null, stubFetch(409, { error: { code: "OTHER", message: "m" } })), { kind: "failed" });
});

test("W34 a confirmed evidence disables the request, manual-insight and decision controls; the conformity note shows only before confirmation", () => {
  const available = { status: "available" as const, registryVersion: "insight-registry-1", proposals: [proposalA()] };
  const before = view(ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { insights: available })));
  assert.ok(decode(before).includes(fr.summary.conformityUnavailable));
  const after = view(ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { insights: available, summary: confirmed() })));
  assert.ok(!decode(after).includes(fr.summary.conformityUnavailable) && decode(after).includes(fr.summary.confirmedHeading));
  const labels: string[] = [fr.insights.retain, fr.insights.discard, fr.insights.manualSubmit, fr.summary.request];
  const buttons = [...after.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].filter((match) => labels.includes(decode(match[2]!).trim()));
  assert.equal(buttons.length, 4);
  for (const match of buttons) assert.match(match[1]!, /disabled=""/);
  assert.match(after, /<textarea id="manual-insight-text"[^>]*disabled=""/);
  assert.ok(!/<button[^>]*>[^<]*Confirmer[^<]*<\/button>/.test(after));
});

test("W35 no conformity or report control or wording, no English text, and the text is shown as text", () => {
  const raw = "<b>gras</b> & <script>x</script>";
  const markup = section({ summary: confirmed({ text: raw }) });
  assert.ok(!markup.includes("<b>gras") && !markup.includes("<script>"));
  const unconfirmed = decode(section({ text: "Texte.", confirming: true }));
  assert.ok(!/Machine conforme|Rapport|Word|PDF/.test(unconfirmed), unconfirmed);
  const english = /(?<!\p{L})(save|approve|conformity|draft|summary|request|loading|confirm|report)(?!\p{L})/iu;
  assert.ok(!english.test(unconfirmed.replace(raw, "")));
  assert.ok(!english.test(decode(markup).replace(raw, "")));
});
