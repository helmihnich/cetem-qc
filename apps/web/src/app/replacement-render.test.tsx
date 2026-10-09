import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { requestReplacementControl, singleFlight, TaskCreation } from "./task-creation";
import type { ReplacementMode } from "./task-creation";
import { canReplace, TaskListView } from "./task-list";
import type { TaskListViewProps } from "./task-list";

// Story 8.3 (W2–W5): the Responsable's replacement control after server acceptance; synthetic names only.
// The web tsconfig keeps Next's `jsx: preserve`, so tsx compiles JSX with the classic runtime,
// which resolves `React` from the global scope inside the rendered components.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const ORIGINAL = "00000000-0000-4000-8000-000000000101";
const REPLACEMENT = "00000000-0000-4000-8000-000000000102";
const DRAFT = "00000000-0000-4000-8000-000000000103";
const ACCEPTED = "00000000-0000-4000-8000-000000000104";
const ASSIGNEE = "00000000-0000-4000-8000-000000000105";

type Task = TaskListViewProps["tasks"][number];
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, type: "graphie_mobile", establishment: `Centre ${id.slice(-3)}`, assignee: "Employé Test",
  assigneeActive: true, assignmentVersion: 1, assignmentHistory: [], recoveryState: null, recoveryRevision: null,
  recoverySource: null, recoverySuccessorTaskId: null,
  state: "draft", lastUpdatedAt: "2026-10-05T10:00:00.000Z", replacementOf: null, replacedBy: null, ...overrides,
});
const input = { establishment: "Centre Remplacement", service: "Radiologie", type: "graphie_mobile", assigneeId: ASSIGNEE } as const;

const noop = () => undefined;
const viewProps = (overrides: Partial<TaskListViewProps> = {}): TaskListViewProps => ({
  tasks: [], loading: false, error: false, onRetry: noop, onReplace: noop, onCancelReplacement: noop, onReplacementCreated: noop, onStale: noop, ...overrides,
});
const render = (overrides: Partial<TaskListViewProps> = {}) => renderToStaticMarkup(<TaskListView {...viewProps(overrides)} />);

/** The table row of one task in the rendered markup. */
const rowOf = (html: string, id: string) => {
  const start = html.lastIndexOf("<tr>", html.indexOf(`<span class="visually-hidden">${id}</span>`));
  return html.slice(start, html.indexOf("</tr>", start));
};

/** Every element of a React tree (components are not expanded), for calling the handlers it carries. */
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as React.ReactNode)];
}

function stubFetch(status: number, body: unknown, calls: Array<{ url: string; method?: string; body?: unknown }> = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("W2 the list shows both state pills, both lineage lines, and the action only on a submitted row without replacement", () => {
  const html = render({ tasks: [
    task(ORIGINAL, { state: "submitted", replacedBy: REPLACEMENT }),
    task(REPLACEMENT, { replacementOf: ORIGINAL }),
    task(DRAFT),
    task(ACCEPTED, { state: "submitted" }),
  ] });
  assert.equal(html.split("Créer un contrôle de remplacement").length - 1, 1);
  assert.match(rowOf(html, ACCEPTED), /Soumis — accepté par le serveur[\s\S]*Créer un contrôle de remplacement/);
  assert.match(rowOf(html, ACCEPTED), /task-state-submitted/);

  const original = rowOf(html, ORIGINAL);
  assert.match(original, new RegExp(`Remplacé par l’audit ${REPLACEMENT}`));
  assert.match(original, /Soumis — accepté par le serveur/, "the state pill is unchanged by the replacement");
  assert.doesNotMatch(original, /Créer un contrôle/);

  const replacement = rowOf(html, REPLACEMENT);
  assert.match(replacement, new RegExp(`Remplacement de l’audit ${ORIGINAL}`));
  assert.match(replacement, /task-state-draft[\s\S]*Brouillon/);
  assert.doesNotMatch(replacement, /Créer un contrôle|Remplacé par/);

  const draft = rowOf(html, DRAFT);
  assert.match(draft, /Brouillon/);
  assert.doesNotMatch(draft, /Soumis|Remplac|Créer un contrôle/);
  // Labels supplement the colour: every pill carries its text.
  assert.equal(html.split("status-pill").length - 1, 4);
});

test("an inactive original assignee keeps accepted replacement action and historical lineage visible", () => {
  const acceptedInactive = task(ACCEPTED, { assignee: "Sami Ben Ali \u2014 Inactif", state: "submitted" });
  const replacedInactive = task(ORIGINAL, {
    assignee: "Amel Ben Ali \u2014 Inactif", state: "submitted", replacedBy: REPLACEMENT,
  });
  const html = render({ tasks: [acceptedInactive, replacedInactive] });

  assert.match(rowOf(html, ACCEPTED), /Sami Ben Ali \u2014 Inactif[\s\S]*Soumis \u2014 accept\u00e9 par le serveur[\s\S]*Cr\u00e9er un contr\u00f4le de remplacement/);
  assert.equal(canReplace(acceptedInactive), true, "assignee activity does not gate the action");
  const replacedRow = rowOf(html, ORIGINAL);
  assert.ok(replacedRow.includes("Amel Ben Ali \u2014 Inactif"));
  assert.ok(replacedRow.includes(`Remplac\u00e9 par l\u2019audit ${REPLACEMENT}`));
  assert.doesNotMatch(rowOf(html, ORIGINAL), /Cr\u00e9er un contr\u00f4le de remplacement/, "an already replaced task stays non-actionable");
});

test("Story 8.4 renders state-specific actions without overriding 8.1–8.3 owners", () => {
  const unstarted = task(ORIGINAL, { assignee: "Employé Test — Inactif", assigneeActive: false, recoveryState: "unstarted" });
  const synchronized = task(DRAFT, { assignee: "Employé Test — Inactif", assigneeActive: false, recoveryState: "synchronized-draft", recoveryRevision: 1 });
  const correction = task(REPLACEMENT, { assignee: "Employé Test — Inactif", assigneeActive: false, recoveryState: "correction-draft", recoveryRevision: 2 });
  const conflict = task(ASSIGNEE, { assignee: "Employé Test — Inactif", assigneeActive: false, recoveryState: "resolution-required" });
  const accepted = task(ACCEPTED, { assignee: "Employé Test — Inactif", assigneeActive: false, state: "submitted", recoveryState: "accepted" });
  const recoveredSource = task("00000000-0000-4000-8000-000000000106", {
    assignee: "Employé Test — Inactif", assigneeActive: false, recoveryState: "recovered",
    recoverySuccessorTaskId: REPLACEMENT, assignmentHistory: [{ previousEmployee: "Employé Test", newEmployee: "Successor Test", actor: "Responsable Test", reason: "deactivated-assignee-recovery", createdAt: "2026-10-05T10:00:00.000Z" }],
  });
  const successor = task("00000000-0000-4000-8000-000000000107", {
    assigneeActive: false, recoveryState: "recovered", recoverySuccessorTaskId: null,
    recoverySource: { taskId: recoveredSource.id, auditId: ASSIGNEE, revision: 1 },
  });
  const html = render({ tasks: [unstarted, synchronized, correction, conflict, accepted, recoveredSource, successor] });
  const row = (id: string) => rowOf(html, id);
  assert.match(row(ORIGINAL), /Action requise[\s\S]*peut contenir du travail non synchronisé[\s\S]*données présentes uniquement sur une tablette[\s\S]*Réaffecter la tâche/);
  assert.match(row(DRAFT), /Action requise[\s\S]*Créer un nouveau travail de récupération/);
  assert.match(row(REPLACEMENT), /Action requise[\s\S]*brouillon source et son historique de correction restent attribués au compte d’origine[\s\S]*Créer un nouveau travail de récupération/);
  assert.match(row(ASSIGNEE), /Résolution requise[\s\S]*Aucun transfert[\s\S]*reste à résoudre selon le parcours de synchronisation/);
  assert.doesNotMatch(row(ASSIGNEE), /Réaffecter la tâche|Créer un nouveau travail de récupération/);
  assert.match(row(ACCEPTED), /accepté par le serveur[\s\S]*Créer un contrôle de remplacement/);
  assert.doesNotMatch(row(ACCEPTED), /Action requise|Créer un nouveau travail de récupération/);
  assert.match(row(recoveredSource.id), /Nouveau travail créé : tâche/);
  assert.match(row(successor.id), new RegExp(`Travail récupéré depuis la tâche ${recoveredSource.id}, révision 1`));
  assert.match(row(recoveredSource.id), /Historique des affectations/);
  assert.equal(html.split("Créer un contrôle de remplacement").length - 1, 1);
});

test("W3 the action opens the empty creation form in replacement mode, the 201 shows its status and the reloaded list both lines", async () => {
  const replaced: string[] = [];
  const accepted = [task(ORIGINAL, { state: "submitted" }), task(DRAFT)];
  const tree = TaskListView(viewProps({ tasks: accepted, onReplace: (id) => replaced.push(id) }));
  const action = elements(tree).find((element) => element.type === "button" && element.props.children === "Créer un contrôle de remplacement")!;
  (action.props.onClick as () => void)();
  assert.deepEqual(replaced, [ORIGINAL]);

  const html = render({ tasks: accepted, replacingTaskId: ORIGINAL });
  const form = html.slice(html.indexOf("task-replacement-card"));
  assert.match(form, /<h2[^>]*>Créer un contrôle de remplacement<\/h2>/);
  assert.match(form, new RegExp(`Remplacement de l’audit ${ORIGINAL}\\. L’audit d’origine et ses mesures restent inchangés\\.`));
  assert.equal((form.match(/<input required="" maxLength="200" value=""/g) ?? []).length, 1, "the establishment starts empty");
  assert.match(form, /<input maxLength="200" value=""/, "the service starts empty");
  assert.match(form, /<option value="" selected="">Chargement…<\/option>/, "no assignee is preselected");
  assert.match(form, /Graphie fixe \(bientôt disponible\)[\s\S]*Scopie \(non disponible\)/);
  assert.match(form, />Créer le contrôle de remplacement<\/button>/);
  assert.match(form, /<button class="secondary-button" type="button">Annuler<\/button>/);
  assert.doesNotMatch(html, /Contrôle de remplacement créé/, "nothing claims a replacement before the 201");

  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const outcome = await requestReplacementControl(ORIGINAL, input, stubFetch(201, {
    task: { id: REPLACEMENT, establishment: input.establishment, service: input.service, type: "graphie_mobile", assigneeId: ASSIGNEE, creatorId: ASSIGNEE, createdAt: "2026-10-05T10:00:00.000Z", state: "draft" },
    replacementOf: { taskId: ORIGINAL, auditId: "00000000-0000-4000-8000-000000000106" },
  }, calls));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.task.id, REPLACEMENT);
  assert.deepEqual(calls.map((call) => [call.url, call.method]), [[`/api/tasks/${ORIGINAL}/replacements`, "POST"]]);
  assert.deepEqual(JSON.parse(String(calls[0]!.body)), input);

  // After the 201 the form is closed, the status message is shown and the list is reloaded.
  const reloaded = render({
    tasks: [task(ORIGINAL, { state: "submitted", replacedBy: REPLACEMENT }), task(REPLACEMENT, { replacementOf: ORIGINAL }), task(DRAFT)],
    createdReplacementId: REPLACEMENT,
  });
  assert.match(reloaded, new RegExp(`role="status"><strong>Contrôle de remplacement créé</strong><span>Identifiant de la tâche : ${REPLACEMENT}</span><span>Brouillon</span>`));
  assert.doesNotMatch(reloaded, /task-replacement-card/);
  assert.match(rowOf(reloaded, ORIGINAL), new RegExp(`Remplacé par l’audit ${REPLACEMENT}`));
  assert.match(rowOf(reloaded, REPLACEMENT), new RegExp(`Remplacement de l’audit ${ORIGINAL}`));
  assert.doesNotMatch(reloaded, /Créer un contrôle de remplacement/, "the action disappears from the original");
});

test("W4 each refusal and failure shows its text and asks for the documented reload", async () => {
  const cases: Array<[number, unknown, { message: string; reloadList: boolean; reloadAssignees: boolean }]> = [
    [409, { error: { code: "REPLACEMENT_ALREADY_EXISTS", message: "x" } }, { message: "Un contrôle de remplacement existe déjà pour cet audit.", reloadList: true, reloadAssignees: false }],
    [409, { error: { code: "AUDIT_NOT_ACCEPTED", message: "x" } }, { message: "Cet audit n’est plus disponible pour un remplacement. Actualisez la liste.", reloadList: true, reloadAssignees: false }],
    [404, { error: { code: "TASK_NOT_FOUND", message: "x" } }, { message: "Cet audit n’est plus disponible pour un remplacement. Actualisez la liste.", reloadList: true, reloadAssignees: false }],
    [422, { error: { code: "TASK_ASSIGNEE_UNAVAILABLE", message: "x" } }, { message: "Ce Technicien n’est plus disponible. Actualisez la page et réessayez.", reloadList: false, reloadAssignees: true }],
    [400, { error: { code: "VALIDATION_ERROR", message: "x" } }, { message: "Le contrôle de remplacement n’a pas pu être créé. L’audit d’origine est inchangé.", reloadList: false, reloadAssignees: false }],
    [500, { error: { code: "INTERNAL_ERROR", message: "détail serveur" } }, { message: "Le contrôle de remplacement n’a pas pu être créé. L’audit d’origine est inchangé.", reloadList: false, reloadAssignees: false }],
    [201, { unexpected: true }, { message: "Le contrôle de remplacement n’a pas pu être créé. L’audit d’origine est inchangé.", reloadList: false, reloadAssignees: false }],
    [503, { error: { code: "SERVICE_UNAVAILABLE", message: "x" } }, { message: "Le service est momentanément indisponible.", reloadList: false, reloadAssignees: false }],
  ];
  for (const [status, body, expected] of cases) {
    assert.deepEqual(await requestReplacementControl(ORIGINAL, input, stubFetch(status, body)), { ok: false, ...expected }, `${status}`);
  }
  const offline = await requestReplacementControl(ORIGINAL, input, (async () => { throw new TypeError("network"); }) as typeof fetch);
  assert.deepEqual(offline, { ok: false, message: "Le service est momentanément indisponible.", reloadList: false, reloadAssignees: false });

  // A double click while the first request is pending sends one request.
  let release!: () => void;
  const calls: string[] = [];
  const pendingFetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    await new Promise<void>((resolve) => { release = resolve; });
    return new Response(JSON.stringify({ error: { code: "REPLACEMENT_ALREADY_EXISTS" } }), { status: 409 });
  }) as typeof fetch;
  const guarded = singleFlight((run: () => Promise<unknown>) => run());
  const first = guarded(() => requestReplacementControl(ORIGINAL, input, pendingFetch));
  const second = guarded(() => requestReplacementControl(ORIGINAL, input, pendingFetch));
  assert.equal(await second, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.equal(((await first) as { ok: boolean }).ok, false);
  assert.equal(calls.length, 1);
  // Once settled, a new click sends again.
  await guarded(() => requestReplacementControl(ORIGINAL, input, stubFetch(409, { error: { code: "REPLACEMENT_ALREADY_EXISTS" } })));
});

test("W5 cancel closes the replacement form and sends nothing", () => {
  const originalFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; return new Response("{}"); }) as typeof fetch;
  try {
    let cancelled = 0;
    const props = viewProps({ tasks: [task(ORIGINAL, { state: "submitted" })], replacingTaskId: ORIGINAL, onCancelReplacement: () => { cancelled++; } });
    const form = elements(TaskListView(props)).find((element) => element.type === TaskCreation)!;
    const mode = form.props.replacement as ReplacementMode;
    assert.equal(mode.originalTaskId, ORIGINAL);
    // The cancel button is not a submit button: it only calls onCancel.
    assert.match(renderToStaticMarkup(<TaskCreation replacement={mode} />), /<button class="secondary-button" type="button">Annuler<\/button>/);
    mode.onCancel();
    assert.equal(cancelled, 1);
    const closed = render({ tasks: props.tasks });
    assert.doesNotMatch(closed, /task-replacement-card|Remplacement de l’audit/);
    assert.match(closed, /Créer un contrôle de remplacement/, "the original can still be replaced later");
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the normal task creation form is unchanged outside replacement mode", () => {
  const html = renderToStaticMarkup(<TaskCreation />);
  assert.match(html, /<h2 id="task-create-title">Créer une tâche<\/h2>/);
  assert.match(html, />Créer la tâche<\/button>/);
  assert.doesNotMatch(html, /Annuler|remplacement/);
});
