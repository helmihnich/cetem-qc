import { GRAPHIE_CALCULATION_IDENTITY } from "./graphie-identity.js";
import type { GraphieTestName, GraphieValue, GraphieVerdict, UnavailableReason } from "./graphie-calculations.js";
import { GRAPHIE_SOURCE_REGRESSION_FIXTURES } from "./graphie-calculations.source-regression.js";
import { calculateGraphieResults } from "./graphie-inputs.js";
import type { GraphieCalculationResults } from "./graphie-inputs.js";

/** The four case kinds CETEM must approve for each paper test (Story 6.5). */
export type AcceptanceCaseKind = "normal" | "abnormal" | "invalid" | "boundary";

export const ACCEPTANCE_CASE_KINDS: readonly AcceptanceCaseKind[] = ["normal", "abnormal", "invalid", "boundary"];

/** The five paper tests, in paper-form order. */
export const GRAPHIE_ACCEPTANCE_TESTS: readonly GraphieTestName[] = [
  "voltage-accuracy",
  "voltage-repeatability",
  "output-repeatability",
  "output-linearity",
  "light-field",
];

/**
 * CETEM-approved reference case. Only a CETEM-signed dataset can supply these; workbook, paper-form,
 * synthetic or test-only cases are never added here. Source-regression evidence lives in
 * `graphie-calculations.source-regression.ts` and is not business approval.
 */
export type ApprovedAcceptanceFixture = {
  category: "approved-acceptance";
  /** As numbered in the CETEM approval document. */
  id: string;
  test: GraphieTestName;
  caseKind: AcceptanceCaseKind;
  approval: {
    /** CETEM signatory as written on the approval. */
    approvedBy: string;
    /** ISO date YYYY-MM-DD. */
    approvedOn: string;
    /** Approval document identifier. */
    documentRef: string;
    /** Must equal `GRAPHIE_CALCULATION_IDENTITY.ruleId`. */
    ruleId: string;
    /** Must equal `GRAPHIE_CALCULATION_IDENTITY.ruleVersion`. */
    ruleVersion: string;
  };
  /** Paper-form field ID -> value as entered. */
  values: Readonly<Record<string, string>>;
  expected: {
    /** Path inside that test's result `values`, e.g. "deviationPercent.0", "k2". */
    values: Readonly<Record<string, number | { unavailable: UnavailableReason }>>;
    verdict: GraphieVerdict["status"];
  };
  /** `exact`: strict numeric equality; `approx`: |actual − expected| ≤ 1e-9, as source-regression. */
  match: "exact" | "approx";
  /** No workbook provenance allowed. */
  source?: never;
  note?: string;
};

/** Empty until CETEM supplies a signed reference dataset (DEP-02). */
export const GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES: readonly ApprovedAcceptanceFixture[] = [];

/** `covered` only means the four case kinds exist; it is not business acceptance and never feeds a verdict. */
export type GraphieAcceptanceStatus =
  | { test: GraphieTestName; status: "blocked"; missingCaseKinds: AcceptanceCaseKind[] }
  | { test: GraphieTestName; status: "covered" };

const isCurrentRule = (fixture: ApprovedAcceptanceFixture) =>
  fixture.approval.ruleId === GRAPHIE_CALCULATION_IDENTITY.ruleId && fixture.approval.ruleVersion === GRAPHIE_CALCULATION_IDENTITY.ruleVersion;

/**
 * Per paper test, in paper order: `blocked` until approved cases for the current rule cover every case kind.
 * Cases that fail `assertApprovedFixtures` (incomplete provenance, other rule version) never count. Light field is always `blocked`.
 */
export function graphieAcceptanceStatus(fixtures: readonly ApprovedAcceptanceFixture[]): GraphieAcceptanceStatus[] {
  const counted = fixtures.filter(isValidApprovedFixture);
  return GRAPHIE_ACCEPTANCE_TESTS.map((test) => {
    const kinds = new Set(counted.filter((fixture) => fixture.test === test).map((fixture) => fixture.caseKind));
    const missingCaseKinds = ACCEPTANCE_CASE_KINDS.filter((kind) => !kinds.has(kind));
    if (test === "light-field" || missingCaseKinds.length > 0) return { test, status: "blocked", missingCaseKinds };
    return { test, status: "covered" };
  });
}

const sourceRegressionCells = new Set(GRAPHIE_SOURCE_REGRESSION_FIXTURES.map((fixture) => fixture.source.cell));

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Throws unless every fixture carries complete approval provenance for the current rule, has no workbook provenance and a unique id. */
export function assertApprovedFixtures(fixtures: readonly ApprovedAcceptanceFixture[]): void {
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    const fail = (message: string): never => {
      throw new Error(`approved-acceptance fixture ${JSON.stringify(fixture.id)}: ${message}`);
    };
    if (typeof fixture.id !== "string" || fixture.id.trim() === "") fail("id is empty");
    if (fixture.category !== "approved-acceptance") fail("category must be approved-acceptance");
    if ("source" in fixture) fail("workbook provenance is not allowed");
    if (sourceRegressionCells.has(fixture.id)) fail("id is a source-regression workbook cell");
    if (!ACCEPTANCE_CASE_KINDS.includes(fixture.caseKind)) fail(`unknown case kind ${String(fixture.caseKind)}`);
    if (!GRAPHIE_ACCEPTANCE_TESTS.includes(fixture.test)) fail(`unknown test ${String(fixture.test)}`);
    for (const key of ["approvedBy", "approvedOn", "documentRef", "ruleId", "ruleVersion"] as const) {
      const value = fixture.approval?.[key];
      if (typeof value !== "string" || value.trim() === "") fail(`approval.${key} is empty`);
    }
    if (!isIsoDate(fixture.approval.approvedOn)) fail(`approval.approvedOn ${fixture.approval.approvedOn} is not an ISO date`);
    if (!isCurrentRule(fixture)) {
      fail(`approved for ${fixture.approval.ruleId} ${fixture.approval.ruleVersion}, not ${GRAPHIE_CALCULATION_IDENTITY.ruleId} ${GRAPHIE_CALCULATION_IDENTITY.ruleVersion}; it must be re-approved`);
    }
    if (ids.has(fixture.id)) fail("duplicate id");
    ids.add(fixture.id);
  }
}

function isValidApprovedFixture(fixture: ApprovedAcceptanceFixture): boolean {
  try {
    assertApprovedFixtures([fixture]);
    return true;
  } catch {
    return false;
  }
}

const resultKey: { readonly [TTest in GraphieTestName]: keyof GraphieCalculationResults } = {
  "voltage-accuracy": "voltageAccuracy",
  "voltage-repeatability": "voltageRepeatability",
  "output-repeatability": "outputRepeatability",
  "output-linearity": "outputLinearity",
  "light-field": "lightFieldCorrespondence",
};

function valueAt(values: unknown, path: string): GraphieValue | undefined {
  let current: unknown = values;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current as GraphieValue | undefined;
}

/** Runs one approved case through `calculateGraphieResults` with the current identity and throws on any mismatch. */
export function runApprovedAcceptanceFixture(fixture: ApprovedAcceptanceFixture): void {
  const fail = (message: string): never => {
    throw new Error(`approved-acceptance fixture ${JSON.stringify(fixture.id)} (${fixture.test}): ${message}`);
  };
  assertApprovedFixtures([fixture]);
  const result = calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, fixture.values)[resultKey[fixture.test]];
  if (!("test" in result)) return fail("calculation refused the current identity");
  if (result.test !== fixture.test) return fail(`calculation returned ${result.test}`);
  for (const [path, expected] of Object.entries(fixture.expected.values)) {
    const actual = valueAt(result.values, path);
    if (!actual || (actual.status !== "calculated" && actual.status !== "unavailable")) fail(`no value at ${path}`);
    if (typeof expected === "number") {
      if (actual?.status !== "calculated") fail(`${path}: expected ${expected}, got ${JSON.stringify(actual)}`);
      const value = (actual as { value: number }).value;
      const matches = fixture.match === "exact" ? value === expected : Math.abs(value - expected) <= 1e-9;
      if (!matches) fail(`${path}: expected ${expected}, got ${value}`);
    } else if (actual?.status !== "unavailable" || actual.reason !== expected.unavailable) {
      fail(`${path}: expected unavailable ${expected.unavailable}, got ${JSON.stringify(actual)}`);
    }
  }
  if (result.suggestedVerdict.status !== fixture.expected.verdict) {
    fail(`verdict: expected ${fixture.expected.verdict}, got ${result.suggestedVerdict.status}`);
  }
}
