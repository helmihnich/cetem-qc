import type { CalculationContext } from "./graphie-calculations.js";
import type { GraphieCalculationResults } from "./graphie-inputs.js";
import type { RetainedInsight } from "./manual-insights.js";
import { renderSummaryFacts } from "./summary-facts.js";

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

/** The five fixed headings of a summary draft, in order. */
export const SUMMARY_DRAFT_SECTIONS = [
  "Contexte de l’intervention",
  "Contrôles visuels et mécaniques",
  "Mesures et résultats",
  "Constats retenus",
  "Points d’attention",
] as const;

/**
 * Role and standing rules for a provider that supports a separate system instruction. Wording guidance only; it
 * states no CETEM rule or tolerance. The prompt repeats the rules so a provider without this channel gets them too.
 */
export const SUMMARY_SYSTEM_INSTRUCTION = [
  "Tu es un assistant de rédaction technique pour un laboratoire de contrôle de qualité d’équipements d’imagerie médicale.",
  "Tu rédiges en français des brouillons de synthèse sobres, précis et vérifiables, relus puis validés par un Responsable humain.",
  "Tu n’utilises que les données fournies : aucune valeur, règle, tolérance ou constat inventé, aucun calcul supplémentaire.",
  "Tu ne formules jamais de conclusion de conformité globale ni d’approbation de l’appareil : cette décision appartient au Responsable.",
  "Tu réponds en texte brut, sans Markdown.",
].join("\n");

/**
 * The single prompt both providers send: French instructions, a readable rendering of the input set, then the input
 * set itself as canonical JSON (always the last block). Only the rendering is new; the input set is unchanged.
 * Wording guidance only; it states no CETEM rule or tolerance.
 */
export function buildSummaryPrompt(set: SummaryInputSet): string {
  return [
    "Rédige le brouillon de synthèse d’un contrôle de qualité d’un appareil mobile de radiographie, destiné au Responsable.",
    "",
    "Règles impératives :",
    "- Utilise uniquement les données fournies ci-dessous (valeurs saisies, résultats de calcul avec leur verdict suggéré par essai, constats retenus).",
    "- N’invente aucune valeur, aucune règle, aucune tolérance et aucun constat. Reprends les valeurs et les unités telles qu’elles figurent dans les données lisibles, sans les recalculer ni les arrondir davantage.",
    "- N’indique aucune conformité globale de l’appareil et aucune approbation : cette décision appartient au Responsable. Ne termine pas par une conclusion sur l’appareil.",
    "- Rapporte chaque verdict d’essai tel qu’il est donné, en précisant qu’il s’agit d’un verdict suggéré par le calcul.",
    "- Signale les verdicts « indisponible » comme non disponibles, avec leur motif.",
    "- Ne mentionne aucun nom de personne.",
    "- Si une rubrique n’a aucune donnée, écris « Aucune donnée renseignée. »",
    "",
    "Format attendu :",
    "- Texte brut en français, sans Markdown : pas de **, de #, de tableau ni d’emoji. Les listes utilisent « - » en début de ligne.",
    "- Ton professionnel, neutre et factuel ; phrases courtes ; 120 à 300 mots au total.",
    "- Cinq rubriques, dans cet ordre, chacune introduite par son titre seul sur une ligne, suivie d’une ligne vide entre rubriques :",
    ...SUMMARY_DRAFT_SECTIONS.map((heading) => `  ${heading}`),
    "- « Contexte de l’intervention » : nature de l’intervention, équipement contrôlé et instruments utilisés, d’après les valeurs saisies.",
    "- « Contrôles visuels et mécaniques » : résultat des points contrôlés (Oui, Non, N.A) tels que saisis.",
    "- « Mesures et résultats » : une ligne « - » par essai avec le nom de l’essai, les valeurs clés avec leurs unités, l’écart et le verdict suggéré.",
    "- « Constats retenus » : reformulation fidèle des constats retenus, sans en ajouter.",
    "- « Points d’attention » : données manquantes ou invalides, verdicts indisponibles, verdicts suggérés non conformes tels qu’indiqués, commentaires du technicien.",
    "",
    "Données lisibles :",
    renderSummaryFacts(set),
    "",
    "Données brutes (référence, JSON canonique ; en cas de doute, elles font foi) :",
    canonicalJson(set),
  ].join("\n");
}
