import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fr } from "@cetem-qc/i18n";
import { EvidenceSteps, ACCEPTED_EVIDENCE_TARGETS } from "./evidence-steps";
import { TaskListView } from "./task-list";
import type { TaskFilter, TaskListViewProps } from "./task-list";
import { LoadingSkeleton, matchesQuery } from "./ui";

// UX pass: client-side filtering of loaded rows, step navigation and loading placeholders. Synthetic names only.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const noop = () => undefined;
type Task = TaskListViewProps["tasks"][number];
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id, type: "graphie_mobile", establishment: `Centre ${id.slice(-3)}`, assignee: "Employé Test",
  assigneeActive: true, assignmentVersion: 1, assignmentHistory: [], recoveryState: null, recoveryRevision: null,
  recoverySource: null, recoverySuccessorTaskId: null,
  state: "draft", lastUpdatedAt: "2026-10-05T10:00:00.000Z", replacementOf: null, replacedBy: null, ...overrides,
});
const tasks = [
  task("00000000-0000-4000-8000-000000000301", { establishment: "Hôpital Nord", assignee: "Sami Exemple" }),
  task("00000000-0000-4000-8000-000000000302", { establishment: "Clinique Sud", assignee: "Amel Exemple", state: "submitted" }),
];
const render = (filter: TaskFilter | undefined, onFilterChange?: (filter: TaskFilter) => void) => renderToStaticMarkup(<TaskListView
  tasks={tasks} loading={false} error={false} onRetry={noop} onReplace={noop} onCancelReplacement={noop} onReplacementCreated={noop} onStale={noop}
  {...(filter ? { filter } : {})} {...(onFilterChange ? { onFilterChange } : {})} />);

test("the search ignores case and accents and needs every word", () => {
  assert.equal(matchesQuery(["Hôpital Nord", "Sami Exemple"], "hopital"), true);
  assert.equal(matchesQuery(["Hôpital Nord", "Sami Exemple"], "NORD sami"), true);
  assert.equal(matchesQuery(["Hôpital Nord", "Sami Exemple"], "nord amel"), false);
  assert.equal(matchesQuery(["x"], "   "), true);
});

test("the task filter narrows only the rows on screen and offers a reset when nothing matches", () => {
  const all = render({ query: "", state: "all" }, noop);
  assert.match(all, /Hôpital Nord[\s\S]*Clinique Sud/);
  assert.match(all, /role="search"/);
  assert.match(all, /aria-pressed="true"[^>]*>[\s\S]*?Total/);
  const searched = render({ query: "clinique", state: "all" }, noop);
  assert.ok(!searched.includes("Hôpital Nord") && searched.includes("Clinique Sud"));
  assert.match(searched, /1 sur 2/);
  const accepted = render({ query: "", state: "accepted" }, noop);
  assert.ok(!accepted.includes("Hôpital Nord") && accepted.includes("Clinique Sud"));
  const none = render({ query: "inexistant", state: "all" }, noop);
  assert.ok(none.includes(fr.shell.filters.noMatch) && none.includes(fr.shell.filters.reset));
  // Without the filter handler the list is unchanged: no toolbar, the static stat strip, every row.
  const plain = render(undefined);
  assert.ok(!plain.includes('role="search"') && plain.includes("<dl class=\"stat-strip\">"));
  assert.match(plain, /Hôpital Nord[\s\S]*Clinique Sud/);
});

test("the step navigation links every workflow section in order and marks the next step", () => {
  const markup = renderToStaticMarkup(<EvidenceSteps targets={ACCEPTED_EVIDENCE_TARGETS} progress={{ insights: true, summary: false, decision: false, report: false }} />);
  const hrefs = [...markup.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, Object.values(ACCEPTED_EVIDENCE_TARGETS));
  assert.equal(markup.split("evidence-step-done").length - 1, 3);
  assert.match(markup, /evidence-step-current"><a href="#evidence-summary-heading" aria-current="step"/);
  assert.ok(!markup.includes("<button"), "navigation only, no action on the record");
  assert.ok(!renderToStaticMarkup(<EvidenceSteps targets={ACCEPTED_EVIDENCE_TARGETS} />).includes("aria-current"), "read-only records show no progress");
});

test("the loading placeholder announces « Chargement… » first", () => {
  assert.match(renderToStaticMarkup(<LoadingSkeleton />), /role="status">Chargement…<span class="skeleton-lines" aria-hidden="true">/);
});
