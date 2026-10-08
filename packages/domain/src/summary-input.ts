import type { CalculationContext } from "./graphie-calculations.js";
import type { GraphieCalculationResults } from "./graphie-inputs.js";
import type { RetainedInsight } from "./manual-insights.js";

/**
 * The exact data an AI provider may receive for a summary draft (Story 10.1). It holds the stored measurements,
 * the stored results with their per-test verdicts and the retained insights, and no task, establishment, service,
 * employee, author or account name or ID.
 */
export interface SummaryInputSet {
  version: 1;
  identity: CalculationContext;
  values: Record<string, string>;
  results: GraphieCalculationResults;
  insights: Array<
    | { sourceType: "rule"; statement: string }
    | { sourceType: "manual"; text: string; justification: string | null }>;
}

/** JSON with every object key sorted and no whitespace, so equal data always gives equal bytes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}

/** Builds the input set from the stored snapshot parts and the retained insights only. Pure: inputs are never mutated. */
export function buildSummaryInputSet(
  snapshot: { identity: CalculationContext; values: Readonly<Record<string, string>>; results: GraphieCalculationResults },
  retained: readonly RetainedInsight[],
): SummaryInputSet {
  const identity = snapshot.identity;
  return sortKeys({
    version: 1,
    identity: {
      catalogueId: identity.catalogueId,
      catalogueVersion: identity.catalogueVersion,
      schemaVersion: identity.schemaVersion,
      ruleId: identity.ruleId,
      ruleVersion: identity.ruleVersion,
    },
    values: { ...snapshot.values },
    results: snapshot.results,
    insights: retained.map((entry) => entry.sourceType === "rule"
      ? { sourceType: "rule", statement: entry.proposal.statement }
      : { sourceType: "manual", text: entry.insight.text, justification: entry.insight.justification }),
  }) as SummaryInputSet;
}

/** The input set as a plain JSON object for storage. */
export function summaryInputSetPlainObject(set: SummaryInputSet): unknown {
  return JSON.parse(canonicalJson(set));
}

/**
 * The single prompt both providers send: a French instruction followed by the input set, and nothing else.
 * Wording guidance only; it states no CETEM rule or tolerance.
 */
export function buildSummaryPrompt(set: SummaryInputSet): string {
  return [
    "Rédige en français une synthèse courte et factuelle, destinée au Responsable, d’un contrôle de qualité d’un appareil mobile de radiographie.",
    "Résume uniquement les données fournies ci-dessous (valeurs saisies, résultats avec leur verdict par essai, constats retenus).",
    "N’invente aucune valeur, aucune règle, aucune tolérance et aucun constat.",
    "N’indique aucune conformité globale de l’appareil et aucune approbation : cette décision appartient au Responsable.",
    "Signale les verdicts « indisponible » comme non disponibles.",
    "",
    "Données :",
    canonicalJson(set),
  ].join("\n");
}
