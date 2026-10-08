// A valid Story 11.5 history record, shared by the schema, client and web tests (synthetic data only).
const ID = "00000000-0000-4000-8000-000000000801";
const result = { test: "voltage-accuracy", status: "x" };

export const historyOfficialReportFixture = {
  id: ID, candidateId: ID, origin: "generated-word", designatedAt: "2026-10-08T13:00:00.000Z", designatedBy: { id: ID, displayName: "Responsable Test" },
  taskId: ID, auditId: ID, auditRevision: 1, submissionId: ID,
  bindings: { summaryId: ID, summaryVersion: 1, conformityDecisionId: ID, conformityOutcome: "machine-conforme" },
  template: { id: "t", version: "1" }, source: null, file: { name: "Rapport.docx", byteSize: 10, sha256: "a".repeat(64) },
};

export const historyRecordFixture = {
  task: { id: ID, establishment: "Établissement A", service: "Radiologie", assignee: "Employé Test" },
  submission: { submissionId: ID, auditId: ID, revision: 1, submittedBy: { id: ID, displayName: "Employé Test" }, acceptedAt: "2026-10-07T08:00:00.000Z" },
  identity: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
  values: { "header.reportNumber": "R-001" },
  results: { voltageAccuracy: result, voltageRepeatability: result, outputRepeatability: result, outputLinearity: result, lightFieldCorrespondence: result },
  insights: { status: "unavailable", reason: "no-approved-rules", registryVersion: "insight-registry-1", proposals: [] },
  insightDecisions: [],
  manualInsights: [],
  summary: { id: ID, version: 1, text: "Synthèse.", confirmedAt: "2026-10-08T10:00:00.000Z", confirmedBy: { id: ID, displayName: "Responsable Test" }, summaryInputSetId: "b".repeat(64), initialDraft: null },
  summaryVersion: { number: 1, state: "confirmed" },
  summaryHistory: [],
  conformityDecision: { id: ID, outcome: "machine-conforme", decidedAt: "2026-10-08T12:00:00.000Z", decidedBy: { id: ID, displayName: "Responsable Test" }, summaryId: ID, summaryVersion: 1 },
  conformityHistory: [],
  officialReport: historyOfficialReportFixture,
  lineage: [{ relation: "replaced-by", accessible: false, taskId: null, auditId: null, completed: null }],
};
