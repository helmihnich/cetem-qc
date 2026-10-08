import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HistoryListItem, HistoryRecordResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { historyRecordFixture } from "../../../../packages/schemas/src/api/history-fixture";
import { downloadOfficialReportFile, HistoryListView, HistoryRecordView, loadHistoryList, loadHistoryRecord } from "./history";
import { GET as LIST } from "./api/history/route";
import { GET as RECORD } from "./api/history/[taskId]/route";
import { GET as FILE } from "./api/history/[taskId]/official-report/file/route";

// Story 11.5 (W1–W5): read-only history for the Responsable. Synthetic names only.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const TASK = "00000000-0000-4000-8000-000000000801";
const OTHER = "00000000-0000-4000-8000-000000000802";
const decode = (markup: string) => markup.replace(/<[^>]*>/g, " ").replaceAll("&#x27;", "'").replaceAll("&quot;", "\"").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((match) => ({ attrs: match[1]!, label: match[2]! }));
const item = (overrides: Partial<HistoryListItem> = {}): HistoryListItem => ({
  taskId: TASK, type: "graphie_mobile", establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test", auditId: TASK, auditRevision: 1,
  acceptedAt: "2026-10-07T08:00:00.000Z", designatedAt: "2026-10-08T13:00:00.000Z", conformityOutcome: "machine-conforme", reportOrigin: "generated-word", lineage: [], ...overrides,
});
const record = (overrides: Partial<HistoryRecordResponse> = {}): HistoryRecordResponse => ({ ...(historyRecordFixture as unknown as HistoryRecordResponse), lineage: [], ...overrides });
const recordView = (props: Partial<React.ComponentProps<typeof HistoryRecordView>> = {}) =>
  renderToStaticMarkup(<HistoryRecordView taskId={TASK} load={{ kind: "ready", record: record() }} onBack={() => undefined} onRetry={() => undefined} {...props} />);
const listView = (load: React.ComponentProps<typeof HistoryListView>["load"], props: Partial<React.ComponentProps<typeof HistoryListView>> = {}) =>
  renderToStaticMarkup(<HistoryListView load={load} onRetry={() => undefined} onOpen={() => undefined} {...props} />);
const respond = (status: number, body: unknown, calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;

test("W1 the list shows loading, empty and error states, and one « Consulter » row per record in the order received", () => {
  assert.ok(decode(listView(undefined)).includes(fr.common.loading));
  assert.match(listView(undefined), /role="status"/);
  const empty = listView({ kind: "ready", records: [] });
  assert.ok(decode(empty).includes("Aucun contrôle terminé pour le moment."));
  assert.deepEqual(buttons(empty), []);
  const failed = listView({ kind: "failed" });
  assert.ok(decode(failed).includes(fr.history.loadFailed));
  assert.deepEqual(buttons(failed).map((button) => button.label), ["Réessayer"]);
  assert.match(failed, /role="alert"/);
  assert.ok(decode(listView({ kind: "unavailable" })).includes(fr.api.unavailable));
  const rows = listView({ kind: "ready", records: [item({ taskId: OTHER, establishment: "Établissement B", conformityOutcome: "machine-non-conforme", reportOrigin: "uploaded-pdf" }), item()] });
  assert.deepEqual(buttons(rows).map((button) => button.label), ["Consulter", "Consulter"]);
  assert.ok(rows.indexOf(OTHER) < rows.indexOf(`>${TASK}`), "order as returned");
  const text = decode(rows);
  for (const expected of ["Historique des contrôles", "Établissement B", "Machine non conforme", "Machine conforme", "PDF importé", "Word généré"]) assert.ok(text.includes(expected), expected);
  assert.match(listView({ kind: "ready", records: [item()] }, { openTaskId: TASK }), /aria-expanded="true"/);
});

test("W2 the record shows its sections in order, is read only and states the final-conformity note once", () => {
  const markup = recordView();
  const text = decode(markup);
  const order = [
    "Contrôle terminé", "Données saisies", fr.graphieResults.reviewHeading, fr.insights.heading, fr.insights.manualHeading,
    fr.summary.confirmedHeading, fr.conformity.heading, "Rapport officiel",
  ].map((label) => text.indexOf(label));
  assert.ok(order.every((index) => index >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((left, right) => left - right), order, "section order");
  assert.ok(text.includes("Synthèse."));
  assert.ok(text.includes("Machine conforme"));
  assert.equal(text.split("la conformité finale de l'appareil est décidée par le Responsable").length - 1, 1);
  assert.match(markup, /<textarea[^>]*readOnly/);
  assert.deepEqual(buttons(markup).map((button) => button.label), ["Télécharger le rapport officiel", "Retour à l’historique"]);
  for (const forbidden of ["Retenir", "Écarter", "Confirmer", "Rouvrir", "Désigner", "Remplacement", "Approuver", "Enregistrer", "Générer", "Ajouter"]) {
    assert.ok(!buttons(markup).some((button) => button.label.includes(forbidden)), forbidden);
  }
  assert.ok(!/<input/.test(markup));
  assert.doesNotMatch(text, /approuvé par|validé par le client/i);
});

test("W2 the official report block shows origin, designation, file name, size and short hash", () => {
  const text = decode(recordView());
  for (const expected of ["Origine : Word généré", "Désigné par Responsable Test le", "Fichier : Rapport.docx", "Taille : 0 Ko", `Empreinte SHA-256 : ${"a".repeat(12)}…`, "Décision de conformité : Machine conforme"]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(!text.includes("a".repeat(64)));
});

test("W2 loading, not-found and failure states of the record keep the way back", () => {
  assert.ok(decode(recordView({ load: undefined })).includes(fr.common.loading));
  const missing = recordView({ load: { kind: "not-found" } });
  assert.ok(decode(missing).includes(fr.history.recordUnavailable));
  assert.deepEqual(buttons(missing).map((button) => button.label), ["Retour à l’historique"]);
  const failed = recordView({ load: { kind: "failed" } });
  assert.deepEqual(buttons(failed).map((button) => button.label), ["Réessayer", "Retour à l’historique"]);
});

test("W3 lineage lines for accessible and inaccessible relations; « Ouvrir » only when accessible and completed", () => {
  const lineage: HistoryRecordResponse["lineage"] = [
    { relation: "replacement-of", accessible: true, taskId: OTHER, auditId: OTHER, completed: true },
    { relation: "replaced-by", accessible: true, taskId: OTHER, auditId: null, completed: false },
    { relation: "recovery-source", accessible: false, taskId: null, auditId: null, completed: null },
    { relation: "recovery-successor", accessible: true, taskId: OTHER, auditId: OTHER, completed: false },
  ];
  const markup = recordView({ load: { kind: "ready", record: record({ lineage }) }, onOpenRelated: () => undefined });
  const text = decode(markup);
  for (const expected of [`Remplacement de l’audit ${OTHER}`, `Remplacé par la tâche ${OTHER}`, "Travail récupéré depuis un audit hors de votre périmètre", `Nouveau travail créé : audit ${OTHER}`]) {
    assert.ok(text.includes(expected), expected);
  }
  assert.equal(buttons(markup).filter((button) => button.label === "Ouvrir").length, 1);
  const hidden = recordView({ load: { kind: "ready", record: record({ lineage: [{ relation: "replaced-by", accessible: false, taskId: null, auditId: null, completed: null }] }) }, onOpenRelated: () => undefined });
  assert.ok(decode(hidden).includes("Remplacé par un audit hors de votre périmètre"));
  assert.ok(!buttons(hidden).some((button) => button.label === "Ouvrir"));
  const inList = listView({ kind: "ready", records: [item({ lineage })] });
  assert.ok(decode(inList).includes(`Remplacement de l’audit ${OTHER}`));
  assert.ok(!buttons(inList).some((button) => button.label === "Ouvrir"));
});

test("W4 the download shows the in-progress state with disabled controls and the French alerts", async () => {
  const busy = recordView({ download: { pending: true, message: null } });
  assert.ok(decode(busy).includes("Téléchargement en cours…"));
  assert.ok(buttons(busy).every((button) => /disabled/.test(button.attrs)), "controls disabled while downloading");
  const idle = recordView();
  assert.ok(buttons(idle).every((button) => !/disabled/.test(button.attrs)));
  for (const [status, message] of [[404, "Tâche introuvable."], [409, "Le fichier du rapport officiel n’est pas disponible."], [500, "Le rapport n’a pas pu être téléchargé."]] as const) {
    const result = await downloadOfficialReportFile(TASK, respond(status, { error: { code: "X", message: "x" } }));
    const text = decode(recordView({ download: { pending: false, message: ({ "not-found": fr.history.downloadNotFound, "not-ready": fr.history.downloadNotReady, failed: fr.history.downloadFailed } as Record<string, string>)[result.kind] ?? null } }));
    assert.ok(text.includes(message), `${status}`);
    assert.match(recordView({ download: { pending: false, message } }), /role="alert"/);
  }
  assert.deepEqual(await downloadOfficialReportFile(TASK, (async () => { throw new Error("réseau"); }) as typeof fetch), { kind: "failed" });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const saved: Array<{ size: number; fileName: string }> = [];
  const ok = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=\"Rapport-LCQ-officiel-20261008-12345678.pdf\"" } });
  }) as unknown as typeof fetch;
  assert.deepEqual(await downloadOfficialReportFile(TASK, ok, (blob, fileName) => { saved.push({ size: blob.size, fileName }); }), { kind: "saved", fileName: "Rapport-LCQ-officiel-20261008-12345678.pdf" });
  assert.equal(calls.length, 1, "one request");
  assert.equal(calls[0]!.url, `/api/history/${TASK}/official-report/file`);
  assert.deepEqual(saved, [{ size: 3, fileName: "Rapport-LCQ-officiel-20261008-12345678.pdf" }]);
});

test("W4 the loaders parse the contract and map failures", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  assert.deepEqual(await loadHistoryList(respond(200, { records: [item()] }, calls)), { kind: "ready", records: [item()] });
  assert.equal(calls[0]!.url, "/api/history");
  assert.deepEqual(await loadHistoryList(respond(200, { records: [{ nope: 1 }] })), { kind: "failed" });
  assert.deepEqual(await loadHistoryList(respond(500, {})), { kind: "failed" });
  assert.deepEqual(await loadHistoryList(respond(503, {})), { kind: "unavailable" });
  assert.deepEqual(await loadHistoryList((async () => { throw new Error("réseau"); }) as typeof fetch), { kind: "unavailable" });
  assert.equal((await loadHistoryRecord(TASK, respond(200, historyRecordFixture, calls))).kind, "ready");
  assert.equal(calls[1]!.url, `/api/history/${TASK}`);
  assert.deepEqual(await loadHistoryRecord(TASK, respond(404, {})), { kind: "not-found" });
  assert.deepEqual(await loadHistoryRecord(TASK, respond(200, { ...historyRecordFixture, extra: 1 })), { kind: "failed" });
  assert.deepEqual(await loadHistoryRecord(TASK, respond(503, {})), { kind: "unavailable" });
});

test("W4 no English text in the history area", () => {
  const english = /(?<!\p{L})(save|saved|approve|approved|loading|submit|error|failed|delete|edit|please|download|history|report|summary)(?!\p{L})/iu;
  const markup = recordView({ download: { pending: false, message: fr.history.downloadFailed } }) + listView({ kind: "ready", records: [item()] }) + listView({ kind: "failed" }) + listView({ kind: "ready", records: [] });
  assert.doesNotMatch(decode(markup.replace(/<(textarea)[^>]*>[^<]*<\/>/g, "")), english);
  const values = (node: unknown): string[] => typeof node === "string" ? [node] : Object.values(node as Record<string, unknown>).flatMap(values);
  assert.doesNotMatch(values(fr.history).join(" "), english);
});

const token = "opaque-session-token-value-not-for-the-browser";
const originalFetch = globalThis.fetch;
const context = { params: Promise.resolve({ taskId: TASK }) };

test("W5 the Next handlers require the cookie, forward only it, send no-store, pass status and body through and need no CSRF for GET", async () => {
  let forwarded = 0;
  globalThis.fetch = async () => { forwarded++; return Response.json({}); };
  try {
    for (const response of [await LIST(new Request("http://localhost/api/history")), await RECORD(new Request(`http://localhost/api/history/${TASK}`), context), await FILE(new Request(`http://localhost/api/history/${TASK}/official-report/file`), context)]) {
      assert.equal(response.status, 401);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    }
    assert.equal(forwarded, 0);
  } finally { globalThis.fetch = originalFetch; }
  const calls: Array<{ url: string; authorization: string | null; cache?: RequestCache; method?: string; cookie: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), cache: init?.cache, method: init?.method, cookie: new Headers(init?.headers).get("cookie") });
    return Response.json({ records: [] }, { status: 200 });
  };
  try {
    const headers = { cookie: `cetem_qc_session=${token}; other=secret` };
    const list = await LIST(new Request("http://localhost/api/history?x=1", { headers }));
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { records: [] });
    assert.match(list.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(calls[0]!.url.endsWith("/api/v1/history"), true, "the query string is never forwarded");
    const one = await RECORD(new Request(`http://localhost/api/history/${TASK}`, { headers }), context);
    assert.equal(one.status, 200);
    assert.match(calls[1]!.url, new RegExp(`/api/v1/history/${TASK}$`));
    for (const call of calls) {
      assert.equal(call.authorization, `Bearer ${token}`);
      assert.equal(call.cache, "no-store");
      assert.ok(call.method === undefined || call.method === "GET");
      assert.equal(call.cookie, null, "only the bearer token is forwarded, not the cookie");
    }
  } finally { globalThis.fetch = originalFetch; }
  for (const [status, payload] of [[404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }], [500, { error: { code: "INTERNAL_ERROR", message: "x" } }]] as const) {
    globalThis.fetch = async () => Response.json(payload, { status });
    try {
      const headers = { cookie: `cetem_qc_session=${token}` };
      const response = await RECORD(new Request(`http://localhost/api/history/${TASK}`, { headers }), context);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), payload);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("W5 the file handler streams the bytes and their headers unchanged, passes refusals through and returns 503 when unreachable", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 0, 255, 10]);
  const headers = { cookie: `cetem_qc_session=${token}` };
  globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=\"Rapport-LCQ-officiel-20261008-12345678.pdf\"", "content-length": String(bytes.length) } });
  try {
    const response = await FILE(new Request(`http://localhost/api/history/${TASK}/official-report/file`, { headers }), context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("content-disposition"), "attachment; filename=\"Rapport-LCQ-officiel-20261008-12345678.pdf\"");
    assert.equal(response.headers.get("content-length"), String(bytes.length));
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  } finally { globalThis.fetch = originalFetch; }
  for (const [status, payload] of [[404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }], [409, { error: { code: "REPORT_FILE_NOT_READY", message: "x" } }], [500, { error: { code: "INTERNAL_ERROR", message: "x" } }]] as const) {
    globalThis.fetch = async () => Response.json(payload, { status });
    try {
      const response = await FILE(new Request(`http://localhost/api/history/${TASK}/official-report/file`, { headers }), context);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), payload);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    } finally { globalThis.fetch = originalFetch; }
  }
  globalThis.fetch = async () => { throw new Error("connection refused"); };
  try {
    for (const response of [await LIST(new Request("http://localhost/api/history", { headers })), await RECORD(new Request(`http://localhost/api/history/${TASK}`, { headers }), context), await FILE(new Request(`http://localhost/api/history/${TASK}/official-report/file`, { headers }), context)]) {
      assert.equal(response.status, 503);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "SERVICE_UNAVAILABLE");
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    }
  } finally { globalThis.fetch = originalFetch; }
});
