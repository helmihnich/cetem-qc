import { GRAPHIE_MOBILE_POV_CATALOGUE } from "./graphie-catalogue.js";
import type { GraphieCalculationResults } from "./graphie-inputs.js";
import type { GraphieCalculationIdentity } from "./graphie-identity.js";

/** Bumped with any registry change; part of every proposal's provenance. */
export const INSIGHT_REGISTRY_VERSION = "insight-registry-1";

export type InsightSourceKey = { kind: "field"; key: string } | { kind: "result"; key: string };
export interface InsightFinding { sourceKeys: readonly InsightSourceKey[]; params: Record<string, string | number> }

export interface InsightInput {
  submissionId: string;
  identity: GraphieCalculationIdentity;
  values: Readonly<Record<string, string>>;
  results: GraphieCalculationResults;
}

export interface InsightRule {
  /** Stable, kebab-case. */
  ruleId: string;
  /** Integer >= 1. */
  ruleVersion: number;
  /** Where CETEM approved the rule (document, date, approver role). Never empty. */
  approvalReference: string;
  /** Field keys / result keys the rule reads; never workbook-only cells. */
  sources: readonly InsightSourceKey[];
  /** Pure: no clock, randomness, network or database. */
  evaluate(input: InsightInput): readonly InsightFinding[];
}

export interface InsightProposal {
  proposalId: string;
  ruleId: string;
  ruleVersion: number;
  approvalReference: string;
  registryVersion: string;
  submissionId: string;
  sourceKeys: InsightSourceKey[];
  statement: string;
  origin: "deterministic";
}

export type InsightProposalSet =
  | { status: "unavailable"; reason: "no-approved-rules"; registryVersion: string; proposals: [] }
  | { status: "available"; registryVersion: string; proposals: InsightProposal[] };

/** French statement templates by rule ID, filled from the finding params only (`{name}` placeholders). */
export type InsightTemplates = Readonly<Record<string, string>>;

const RESULT_KEYS: readonly string[] = ["voltageAccuracy", "voltageRepeatability", "outputRepeatability", "outputLinearity", "lightFieldCorrespondence"];

/**
 * Project rules for the PoV. They only restate what the stored results and paper-form checks already say —
 * the per-test verdict against the tolerance printed on the signed CETEM paper form, an impossible calculation,
 * or a visual/mechanical check answered « Non » — and invent no tolerance. CETEM validation is still pending,
 * which the approval reference says. A rule is added only with its French template and a fixture test.
 */
export const PROJECT_RULE_REFERENCE = "Règle projet PoV — tolérances du formulaire papier CETEM signé ; validation CETEM en attente";

const TEST_LABELS_FR: Readonly<Record<string, string>> = {
  voltageAccuracy: "Exactitude de la tension",
  voltageRepeatability: "Répétabilité de la tension",
  outputRepeatability: "Reproductibilité et répétabilité du rayonnement de sortie",
  outputLinearity: "Linéarité du rayonnement de sortie",
  lightFieldCorrespondence: "Correspondance champ lumineux / champ de rayons X",
};
const resultSources = RESULT_KEYS.map((key) => ({ kind: "result" as const, key }));
const formatPercent = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

type StoredVerdict = { status: string; reason?: string; tolerance?: { limitPercent: number; comparison: string } };
/** The stored suggested verdict of one result, or undefined for an unsupported-version result. */
function verdictOf(results: InsightInput["results"], key: string): StoredVerdict | undefined {
  const result = (results as unknown as Record<string, { suggestedVerdict?: StoredVerdict } | undefined>)[key];
  return result?.suggestedVerdict;
}
const toleranceText = (tolerance: { limitPercent: number; comparison: string }) =>
  `${tolerance.comparison === "abs-lt" ? "<" : "≤"} ${formatPercent(tolerance.limitPercent)} %`;

const outsideTolerance: InsightRule = {
  ruleId: "test-outside-paper-tolerance",
  ruleVersion: 1,
  approvalReference: PROJECT_RULE_REFERENCE,
  sources: resultSources,
  evaluate: ({ results }) => RESULT_KEYS.flatMap((key) => {
    const verdict = verdictOf(results, key);
    return verdict?.status === "non-conforme" && verdict.tolerance
      ? [{ sourceKeys: [{ kind: "result", key }], params: { test: TEST_LABELS_FR[key]!, tolerance: toleranceText(verdict.tolerance) } }] : [];
  }),
};

const withinTolerance: InsightRule = {
  ruleId: "test-within-paper-tolerance",
  ruleVersion: 1,
  approvalReference: PROJECT_RULE_REFERENCE,
  sources: resultSources,
  evaluate: ({ results }) => RESULT_KEYS.flatMap((key) => {
    const verdict = verdictOf(results, key);
    return verdict?.status === "conforme" && verdict.tolerance
      ? [{ sourceKeys: [{ kind: "result", key }], params: { test: TEST_LABELS_FR[key]!, tolerance: toleranceText(verdict.tolerance) } }] : [];
  }),
};

const calculationUnavailable: InsightRule = {
  ruleId: "test-calculation-unavailable",
  ruleVersion: 1,
  approvalReference: PROJECT_RULE_REFERENCE,
  sources: resultSources,
  evaluate: ({ results }) => RESULT_KEYS.flatMap((key) => {
    const verdict = verdictOf(results, key);
    if (verdict?.status !== "indisponible" || verdict.reason === "no-tolerance") return [];
    const cause = verdict.reason === "invalid-input" ? "valeurs illisibles" : verdict.reason === "zero-denominator" ? "division par zéro (valeur nulle)" : "mesures manquantes";
    return [{ sourceKeys: [{ kind: "result", key }], params: { test: TEST_LABELS_FR[key]!, cause } }];
  }),
};

const checkFields = GRAPHIE_MOBILE_POV_CATALOGUE.sections
  .filter((section) => section.id === "visual" || section.id === "mechanical")
  .flatMap((section) => section.fields.map((field) => ({ id: field.id, labelFr: field.labelFr, sectionFr: section.labelFr })));
const checkAnswerNo: InsightRule = {
  ruleId: "check-answered-no",
  ruleVersion: 1,
  approvalReference: PROJECT_RULE_REFERENCE,
  sources: checkFields.map((field) => ({ kind: "field" as const, key: field.id })),
  evaluate: ({ values }) => checkFields
    .filter((field) => values[field.id] === "Non")
    .map((field) => ({ sourceKeys: [{ kind: "field", key: field.id }], params: { section: field.sectionFr, check: field.labelFr } })),
};

/** The rules evaluated for every accepted audit. */
export const INSIGHT_RULE_REGISTRY: readonly InsightRule[] = [outsideTolerance, withinTolerance, calculationUnavailable, checkAnswerNo];

const workbookOnlyFields = new Set(
  GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields)
    .filter((field) => field.provenance.length > 0 && field.provenance.every((origin) => origin === "CETEM_WORKBOOK"))
    .map((field) => field.id),
);
const knownFields = new Set(GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields).map((field) => field.id));

const sourceLabel = (source: InsightSourceKey) => `${source.kind}:${source.key}`;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Throws when the registry breaks a rule of the approved-rule contract. An empty registry is valid. */
export function validateInsightRegistry(registry: readonly InsightRule[], templates: InsightTemplates = {}): void {
  const seen = new Set<string>();
  for (const rule of registry) {
    if (typeof rule.ruleId !== "string" || rule.ruleId.trim() === "") throw new Error("Insight rule without a rule ID");
    if (!Number.isInteger(rule.ruleVersion) || rule.ruleVersion < 1) throw new Error(`Insight rule ${rule.ruleId} needs a positive integer version`);
    if (typeof rule.approvalReference !== "string" || rule.approvalReference.trim() === "") throw new Error(`Insight rule ${rule.ruleId} has no CETEM approval reference`);
    const identity = `${rule.ruleId}@${rule.ruleVersion}`;
    if (seen.has(identity)) throw new Error(`Duplicate insight rule ${identity}`);
    seen.add(identity);
    if (rule.sources.length === 0) throw new Error(`Insight rule ${rule.ruleId} names no source`);
    for (const source of rule.sources) {
      if (source.kind === "result") {
        if (!RESULT_KEYS.includes(source.key)) throw new Error(`Insight rule ${rule.ruleId} reads unknown result ${source.key}`);
      } else if (!knownFields.has(source.key)) {
        throw new Error(`Insight rule ${rule.ruleId} reads unknown field ${source.key}`);
      } else if (workbookOnlyFields.has(source.key)) {
        throw new Error(`Insight rule ${rule.ruleId} reads workbook-only data ${source.key}`);
      }
    }
    const template = Object.prototype.hasOwnProperty.call(templates, rule.ruleId) ? templates[rule.ruleId] : undefined;
    if (typeof template !== "string" || template.trim() === "") throw new Error(`Insight rule ${rule.ruleId} has no French template`);
  }
}

const fillTemplate = (template: string, params: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder));

/**
 * Pure and deterministic: the same input and registry give the same proposals in the same order.
 * It reads only stored values, stored results and the revision identity; it never recalculates.
 */
export function evaluateInsightProposals(
  input: InsightInput,
  registry: readonly InsightRule[] = INSIGHT_RULE_REGISTRY,
  templates: InsightTemplates = {},
): InsightProposalSet {
  validateInsightRegistry(registry, templates);
  if (registry.length === 0) return { status: "unavailable", reason: "no-approved-rules", registryVersion: INSIGHT_REGISTRY_VERSION, proposals: [] };

  const rules = [...registry].sort((a, b) => compareText(a.ruleId, b.ruleId) || a.ruleVersion - b.ruleVersion);
  const proposals: InsightProposal[] = [];
  for (const rule of rules) {
    const findings = rule.evaluate(input).map((finding) => ({
      params: finding.params,
      sourceKeys: [...finding.sourceKeys].sort((a, b) => compareText(sourceLabel(a), sourceLabel(b))),
    }));
    findings.sort((a, b) => compareText(a.sourceKeys.map(sourceLabel).join(","), b.sourceKeys.map(sourceLabel).join(",")));
    for (const finding of findings) {
      proposals.push({
        proposalId: `${rule.ruleId}:v${rule.ruleVersion}:${input.submissionId}:${finding.sourceKeys.map((source) => `${source.kind}=${source.key}`).join(",")}`,
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        approvalReference: rule.approvalReference,
        registryVersion: INSIGHT_REGISTRY_VERSION,
        submissionId: input.submissionId,
        sourceKeys: finding.sourceKeys.map((source) => ({ kind: source.kind, key: source.key })),
        statement: fillTemplate(templates[rule.ruleId]!, finding.params),
        origin: "deterministic",
      });
    }
  }
  return { status: "available", registryVersion: INSIGHT_REGISTRY_VERSION, proposals };
}
