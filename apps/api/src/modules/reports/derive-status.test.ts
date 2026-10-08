import assert from "node:assert/strict";
import test from "node:test";
import { deriveStatus } from "./queries/report-candidates.js";

// Story 11.4 U1: (outcome x current bindings x official context) -> derived status.

const current = { summaryId: "s1", decisionId: "d1" };
const row = (outcome: "ready" | "failed" | "outdated" | null, overrides: Partial<{ id: string; confirmed_summary_id: string; conformity_decision_id: string }> = {}) =>
  ({ id: "c1", outcome, confirmed_summary_id: "s1", conformity_decision_id: "d1", ...overrides });

test("U1 without an official report the 11.1 derivation is unchanged", () => {
  assert.equal(deriveStatus(row(null), current), "generating");
  assert.equal(deriveStatus(row("failed"), current), "failed");
  assert.equal(deriveStatus(row("ready"), current), "ready");
  assert.equal(deriveStatus(row("ready", { confirmed_summary_id: "s0" }), current), "outdated");
  assert.equal(deriveStatus(row("ready", { conformity_decision_id: "d0" }), current), "outdated");
  assert.equal(deriveStatus(row("outdated"), current), "outdated");
  assert.equal(deriveStatus(row("ready"), { summaryId: null, decisionId: null }), "outdated");
});

test("U1 the official candidate stays official even when its bindings changed; only a would-be ready candidate becomes superseded", () => {
  const official = { officialCandidateId: "c1" };
  assert.equal(deriveStatus(row("ready"), current, official), "official");
  assert.equal(deriveStatus(row("ready", { confirmed_summary_id: "s0" }), current, official), "official");
  assert.equal(deriveStatus(row("ready"), { summaryId: null, decisionId: null }, official), "official");
  const other = { officialCandidateId: "c2" };
  assert.equal(deriveStatus(row("ready"), current, other), "superseded");
  assert.equal(deriveStatus(row("ready", { confirmed_summary_id: "s0" }), current, other), "outdated");
  assert.equal(deriveStatus(row("outdated"), current, other), "outdated");
  assert.equal(deriveStatus(row("failed"), current, other), "failed");
  assert.equal(deriveStatus(row(null), current, other), "generating");
  assert.equal(deriveStatus(row("ready"), current, { officialCandidateId: null }), "ready");
});
