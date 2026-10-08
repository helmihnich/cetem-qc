import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { historyLineageRelationSchema, historyListQuerySchema, historyListResponseSchema, historyRecordResponseSchema } from "./v1.js";
import { historyRecordFixture } from "./history-fixture.js";

// Story 11.5 C1: the history contracts are strict, carry no storage key or URL and match the OpenAPI document.

const ID = "00000000-0000-4000-8000-000000000801";
const item = {
  taskId: ID, type: "graphie_mobile", establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test", auditId: ID, auditRevision: 1,
  acceptedAt: "2026-10-07T08:00:00.000Z", designatedAt: "2026-10-08T13:00:00.000Z", conformityOutcome: "machine-conforme", reportOrigin: "generated-word", lineage: [],
};

test("C1 history list, record and lineage schemas are strict", () => {
  assert.deepEqual(historyListResponseSchema.parse({ records: [] }), { records: [] });
  assert.deepEqual(historyListResponseSchema.parse({ records: [item] }), { records: [item] });
  for (const bad of [{ ...item, storageRef: "reports/x" }, { ...item, url: "https://x" }, { ...item, reportOrigin: "other" }, { ...item, designatedAt: "hier" }, { ...item, auditRevision: 0 }, { ...item, lineage: [{ relation: "x", accessible: true, taskId: ID, auditId: null, completed: false }] }]) {
    assert.equal(historyListResponseSchema.safeParse({ records: [bad] }).success, false, JSON.stringify(bad));
  }
  assert.equal(historyListResponseSchema.safeParse({ records: [], extra: 1 }).success, false);
  assert.equal(historyListQuerySchema.safeParse({}).success, true);
  assert.equal(historyListQuerySchema.safeParse({ x: "1" }).success, false);
  assert.equal(historyLineageRelationSchema.safeParse({ relation: "replacement-of", accessible: true, taskId: ID, auditId: ID, completed: true }).success, true);
  assert.equal(historyLineageRelationSchema.safeParse({ relation: "replacement-of", accessible: true, taskId: ID, auditId: ID, completed: true, extra: 1 }).success, false);

  assert.deepEqual(historyRecordResponseSchema.parse(historyRecordFixture), historyRecordFixture);
  const { summary: _summary, ...withoutSummary } = historyRecordFixture;
  const { officialReport: _official, ...withoutOfficial } = historyRecordFixture;
  for (const bad of [
    { ...historyRecordFixture, extra: true }, { ...historyRecordFixture, summary: null }, { ...historyRecordFixture, conformityDecision: null },
    { ...historyRecordFixture, officialReport: { ...historyRecordFixture.officialReport, storageRef: "x" } }, { ...historyRecordFixture, lineage: { replacementOf: null } },
    { ...historyRecordFixture, task: { ...historyRecordFixture.task, extra: 1 } }, withoutSummary, withoutOfficial,
  ]) assert.equal(historyRecordResponseSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
});

test("C1 the OpenAPI document declares the three operations, the binary response and no storage key or URL", async () => {
  const yaml = await readFile(fileURLToPath(new URL("../../../types/openapi/cetem-qc-v1.yaml", import.meta.url)), "utf8");
  for (const expected of [
    "operationId: listHistory", "operationId: getHistoryRecord", "operationId: downloadOfficialReport", "/history:", "/history/{taskId}:", "/history/{taskId}/official-report/file:",
    "    HistoryListItem:", "    HistoryListResponse:", "    HistoryLineageRelation:", "    HistoryRecordResponse:", "REPORT_FILE_NOT_READY",
  ]) assert.ok(yaml.includes(expected), expected);
  const section = yaml.slice(yaml.indexOf("  /history/{taskId}/official-report/file:"), yaml.indexOf("  /tasks/{taskId}/pdf-files:"));
  assert.ok(section.includes("format: binary") && section.includes("application/pdf") && section.includes("wordprocessingml.document"));
  const schemas = yaml.slice(yaml.indexOf("    HistoryLineageRelation:"), yaml.indexOf("    ReportCandidate:"));
  assert.ok(!/storageRef|storage_ref|url/i.test(schemas));
});
