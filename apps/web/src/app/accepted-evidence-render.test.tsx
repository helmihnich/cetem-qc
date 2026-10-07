import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GRAPHIE_CALCULATION_IDENTITY, calculateGraphieResults } from "@cetem-qc/domain";
import type { CalculationContext } from "@cetem-qc/domain";
import type { AcceptedEvidenceResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { AcceptedEvidenceView, loadAcceptedEvidence } from "./accepted-evidence";
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
  const html = view(ready(evidenceFor(GRAPHIE_CALCULATION_IDENTITY, { lineage: { replacementOf: null, replacedBy: DRAFT, recoverySource: null, recoverySuccessorTaskId: null } })));
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

test("W10 available proposals are shown read-only with rule, approval and source labels; the conformity note appears once", () => {
  const markup = view(availableWith([
    proposal("regle-a", "Observation A.", [{ kind: "field", key: "header.reportNumber" }]),
    proposal("regle-b", "Observation B.", [{ kind: "result", key: "voltageAccuracy" }]),
  ]));
  const section = decode(insightSection(markup));
  for (const expected of ["Observation A.", "Règle regle-a v1", "Règle regle-b v1", "Document synthétique 2026", "Exactitude de la tension"]) assert.ok(section.includes(expected), expected);
  assert.ok(!insightSection(markup).includes("<button") && !insightSection(markup).includes("<input"));
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
