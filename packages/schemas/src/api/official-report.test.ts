import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { apiErrorSchema, officialReportSchema, reportCandidateStatusSchema, reportDesignateRequestSchema } from "./v1.js";

// Story 11.4 C1: the official report contract is strict, carries no storage key and matches the OpenAPI document.

const ID = "00000000-0000-4000-8000-000000000701";
const report = {
  id: ID, candidateId: ID, origin: "uploaded-pdf", designatedAt: "2026-10-08T13:00:00.000Z", designatedBy: { id: ID, displayName: "Responsable Test" },
  taskId: ID, auditId: ID, auditRevision: 1, submissionId: ID,
  bindings: { summaryId: ID, summaryVersion: 1, conformityDecisionId: ID, conformityOutcome: "machine-non-conforme" },
  template: null, source: { fileId: ID }, file: { name: "Rapport.pdf", byteSize: 10, sha256: "a".repeat(64) },
};

test("C1 OfficialReport and ReportDesignateRequest are strict and reject extra properties and storage keys", () => {
  assert.equal(officialReportSchema.safeParse(report).success, true);
  assert.equal(officialReportSchema.safeParse({ ...report, origin: "generated-word", template: { id: "t", version: "1" }, source: null }).success, true);
  for (const bad of [
    { ...report, storageRef: "reports/x.docx" }, { ...report, file: { ...report.file, storageRef: "x" } }, { ...report, bindings: { ...report.bindings, extra: 1 } },
    { ...report, origin: "other" }, { ...report, file: null }, { ...report, designatedAt: "hier" }, { ...report, auditRevision: 0 },
  ]) assert.equal(officialReportSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(reportDesignateRequestSchema.safeParse({}).success, true);
  assert.equal(reportDesignateRequestSchema.safeParse({ attemptId: ID }).success, false);
  assert.deepEqual(reportCandidateStatusSchema.options, ["generating", "ready", "failed", "outdated", "official", "superseded"]);
  assert.equal(apiErrorSchema.safeParse({ error: { code: "REPORT_ALREADY_OFFICIAL", message: "x" } }).success, true);
});

test("C1 the OpenAPI document declares the operations, the schemas and the four error codes", async () => {
  const yaml = await readFile(fileURLToPath(new URL("../../../types/openapi/cetem-qc-v1.yaml", import.meta.url)), "utf8");
  for (const expected of [
    "operationId: designateReportCandidate", "operationId: getOfficialReport", "/tasks/{taskId}/report-candidates/{candidateId}/designate:", "/tasks/{taskId}/official-report:",
    "    OfficialReport:", "    ReportDesignateRequest:", "enum: [generating, ready, failed, outdated, official, superseded]",
    "REPORT_CANDIDATE_NOT_READY", "REPORT_CANDIDATE_OUTDATED", "REPORT_ALREADY_OFFICIAL", "REPORT_OFFICIAL_DESIGNATED",
  ]) assert.ok(yaml.includes(expected), expected);
  assert.ok(!/OfficialReport:[\s\S]*?storageRef/.test(yaml.slice(yaml.indexOf("    OfficialReport:"), yaml.indexOf("    ReportCandidate:"))));
});
