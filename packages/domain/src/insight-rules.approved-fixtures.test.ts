import assert from "node:assert/strict";
import test from "node:test";
import { INSIGHT_RULE_REGISTRY } from "./insight-rules.js";

// Story 9.2 guard: every approved rule needs a fixture test here, named after its rule ID and version.
// The registry is empty until CETEM approves a rule (DEP-01R); add the rule, then its fixture, in the same change.
const FIXTURED_RULES: readonly string[] = [];

test("I1 guard: every rule in the approved registry has a fixture test", () => {
  const missing = INSIGHT_RULE_REGISTRY.map((rule) => `${rule.ruleId}@${rule.ruleVersion}`).filter((id) => !FIXTURED_RULES.includes(id));
  assert.deepEqual(missing, []);
});
