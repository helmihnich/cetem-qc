import assert from "node:assert/strict";
import test from "node:test";
import { DOCX_MEDIA_TYPE, lineageSeeds, officialDownloadIdentity, PDF_MEDIA_TYPE, resolveHistoryLineage } from "./history-support.js";

const lineage = (overrides: Partial<Parameters<typeof lineageSeeds>[0]> = {}) => ({
  state: "submitted" as const, replacementOf: null, replacedBy: null, recoveryState: "accepted" as const,
  recoverySource: null, recoverySuccessorTaskId: null, recoveryRevision: 1, ...overrides,
});

test("U2 lineage visibility: ids and completed only for an authorized related task", () => {
  const seeds = lineageSeeds(lineage({
    replacementOf: "t-original", replacedBy: "t-replacement",
    recoverySource: { taskId: "t-source", auditId: "a-source", revision: 2 }, recoverySuccessorTaskId: "t-successor",
  }));
  assert.deepEqual(seeds.map((seed) => seed.relation), ["replacement-of", "replaced-by", "recovery-source", "recovery-successor"]);
  const all = resolveHistoryLineage(seeds, new Set(["t-original", "t-replacement", "t-source", "t-successor"]), new Map([["t-original", "a-original"], ["t-replacement", "a-replacement"]]), new Set(["t-original"]));
  assert.deepEqual(all, [
    { relation: "replacement-of", accessible: true, taskId: "t-original", auditId: "a-original", completed: true },
    { relation: "replaced-by", accessible: true, taskId: "t-replacement", auditId: "a-replacement", completed: false },
    { relation: "recovery-source", accessible: true, taskId: "t-source", auditId: "a-source", completed: false },
    { relation: "recovery-successor", accessible: true, taskId: "t-successor", auditId: null, completed: false },
  ]);
  const partial = resolveHistoryLineage(seeds, new Set(["t-replacement"]), new Map([["t-replacement", "a-replacement"]]), new Set(["t-replacement"]));
  assert.deepEqual(partial.map((relation) => relation.accessible), [false, true, false, false]);
  for (const hidden of [partial[0]!, partial[2]!, partial[3]!]) assert.deepEqual([hidden.taskId, hidden.auditId, hidden.completed], [null, null, null]);
  assert.deepEqual(resolveHistoryLineage(lineageSeeds(lineage()), new Set(), new Map(), new Set()), []);
});

test("U3 download identity per origin", () => {
  const designatedAt = new Date("2026-10-08T10:00:00.000Z");
  assert.deepEqual(officialDownloadIdentity({ origin: "generated-word", fileName: "Rapport-R-115.docx", candidateId: "c", designatedAt }), { mediaType: DOCX_MEDIA_TYPE, fileName: "Rapport-R-115.docx" });
  assert.deepEqual(officialDownloadIdentity({ origin: "uploaded-pdf", fileName: "ignored.pdf", candidateId: "12345678-aaaa-bbbb-cccc-dddddddddddd", designatedAt }),
    { mediaType: PDF_MEDIA_TYPE, fileName: "Rapport-LCQ-officiel-20261008-12345678.pdf" });
});
