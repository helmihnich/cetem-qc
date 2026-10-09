import { GRAPHIE_MOBILE_POV_CATALOGUE } from "./graphie-catalogue.js";
import type { SummaryInputSet } from "./summary-input.js";

/**
 * Readable French rendering of a summary input set (Story 10.1 follow-up). Presentation only: it reads the stored
 * input set and never changes it, so the stored set and its identity stay exactly what they are. Values are shown as
 * stored (never rounded or recalculated); verdicts are shown as given by the calculation.
 */

/** The five paper tests in the order of the official form, with their French names (same wording as fr.graphieResults.tests). */
export const SUMMARY_TEST_LABELS_FR = {
  voltageAccuracy: "Exactitude de la tension",
  voltageRepeatability: "Répétabilité de la tension",
  outputRepeatability: "Reproductibilité et répétabilité du rayonnement de sortie",
  outputLinearity: "Linéarité du rayonnement de sortie",
  lightFieldCorrespondence: "Correspondance champ lumineux / champ de rayons X",
} as const;

const REASONS_FR: Record<string, string> = {
  "missing-input": "mesure manquante",
  "invalid-input": "valeur numérique invalide",
  "zero-denominator": "division par zéro",
  "no-tolerance": "aucune tolérance imprimée sur le formulaire officiel",
  "unsupported-version": "version de règle non prise en charge",
};

/** Sections whose values identify a person or a date; they are left out of the readable rendering. */
const PERSONAL_SECTIONS = new Set(["controlPerformedBy"]);
const VISUAL_SECTIONS = new Set(["visual", "mechanical"]);
const COMMENT_FIELD = /comments|Comments$/;

type FieldLine = { sectionId: string; section: string; path: string; label: string; unit?: string; value: string; fieldId: string };

/** One line per non-blank catalogue value, in catalogue order: section, table row when any, label and unit. */
export function summaryFieldLines(values: Readonly<Record<string, string>>): FieldLine[] {
  const lines: FieldLine[] = [];
  for (const section of GRAPHIE_MOBILE_POV_CATALOGUE.sections) {
    if (PERSONAL_SECTIONS.has(section.id)) continue;
    const rowOf = new Map<string, string>();
    for (const table of section.tables ?? []) {
      table.fieldIds.forEach((row, index) => row.forEach((id) => rowOf.set(id, table.rowLabelsFr[index] ?? "")));
    }
    for (const field of section.fields) {
      const raw = Object.prototype.hasOwnProperty.call(values, field.id) ? values[field.id] : undefined;
      const value = raw?.trim() ?? "";
      if (value === "") continue;
      const row = rowOf.get(field.id);
      const path = [section.labelFr, ...(row ? [row] : []), field.labelFr].join(" › ");
      lines.push({ sectionId: section.id, section: section.labelFr, path, label: row ? `${row} — ${field.labelFr}` : field.labelFr, value, fieldId: field.id, ...(field.unit ? { unit: field.unit } : {}) });
    }
  }
  return lines;
}

const formatNumber = (value: number) => String(value).replace(".", ",");
/** Calculated values are shown to the hundredth for reading; the exact values stay in the raw data block. */
const formatCalculated = (value: number) => formatNumber(Math.round(value * 100) / 100 || 0);
type Loose = Record<string, unknown> | undefined;
const asRecord = (value: unknown): Loose => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

function formatValue(value: unknown, unit: string): string {
  const record = asRecord(value);
  if (record?.status === "calculated" && typeof record.value === "number") return `${formatCalculated(record.value)} ${unit}`.trim();
  return `indisponible (${REASONS_FR[String(record?.reason ?? "missing-input")] ?? "mesure manquante"})`;
}
const list = (values: unknown): unknown[] => (Array.isArray(values) ? values : []);
const indexed = (prefix: string, values: unknown, unit: string) => list(values).map((value, index) => `${prefix} ${index + 1} : ${formatValue(value, unit)}`);

export type SummaryResultDescription = {
  name: keyof typeof SUMMARY_TEST_LABELS_FR;
  label: string;
  verdict: "conforme" | "non-conforme" | "indisponible" | "non calculé";
  /** The verdict as a French phrase, with the tolerance or the reason when given. */
  verdictText: string;
  /** Calculated values with units, as stored. */
  values: string[];
};

/** French description of each stored test result, in form order. A result the version does not compute is « non calculé ». */
export function describeSummaryResults(results: unknown): SummaryResultDescription[] {
  const all = asRecord(results) ?? {};
  return (Object.keys(SUMMARY_TEST_LABELS_FR) as Array<keyof typeof SUMMARY_TEST_LABELS_FR>).map((name) => {
    const label = SUMMARY_TEST_LABELS_FR[name];
    const result = asRecord(all[name]);
    const verdict = asRecord(result?.suggestedVerdict);
    if (!result?.formulaSource || !verdict) {
      return { name, label, verdict: "non calculé" as const, verdictText: "non calculé pour cette version de règle", values: [] };
    }
    const tolerance = asRecord(verdict.tolerance);
    const toleranceText = tolerance && typeof tolerance.limitPercent === "number"
      ? `tolérance |écart| ${tolerance.comparison === "abs-lt" ? "<" : "≤"} ${formatNumber(tolerance.limitPercent)} %` : "";
    const status = verdict.status === "conforme" || verdict.status === "non-conforme" ? verdict.status : "indisponible";
    const verdictText = status === "indisponible"
      ? `verdict suggéré indisponible (${REASONS_FR[String(verdict.reason)] ?? "motif non précisé"})`
      : `verdict suggéré ${status}${toleranceText ? ` (${toleranceText})` : ""}`;
    const v = asRecord(result.values) ?? {};
    let values: string[];
    switch (result.test) {
      case "voltage-accuracy":
        values = list(v.deviationPercent).map((value, index) => `${["KV min", "KV", "KV max"][index] ?? `Ligne ${index + 1}`} — écart : ${formatValue(value, "%")}`);
        break;
      case "voltage-repeatability":
        values = [`kV moyen : ${formatValue(v.mean, "kV")}`, `kV min : ${formatValue(v.min, "kV")}`, `kV max : ${formatValue(v.max, "kV")}`,
          `écart min / moy : ${formatValue(v.minDeviationPercent, "%")}`, `écart max / moy : ${formatValue(v.maxDeviationPercent, "%")}`];
        break;
      case "output-repeatability":
        values = [`kerma moyen : ${formatValue(v.kermaMean, "mGy")}`, ...indexed("écart mesure", v.deviationPercent, "%")];
        break;
      case "output-linearity":
        values = [...indexed("kerma à 1 m, mesure", v.kermaAt1m, "mGy"), ...indexed("K1, mesure", v.k1, "mGy/mAs"), `K2 : ${formatValue(v.k2, "mGy/mAs")}`,
          ...indexed("écart mesure", v.deviationPercent, "%")];
        break;
      case "light-field":
        values = [`Σ|écarts| : ${formatValue(v.sumAbsGapsMm, "mm")}`, `résultat : ${formatValue(v.resultPercent, "% de la D.F.R")}`];
        break;
      default:
        values = [];
    }
    // A test with no calculated value at all is summarised in one phrase instead of a list of unavailable values.
    const anyCalculated = JSON.stringify(v).includes('"status":"calculated"');
    return { name, label, verdict: status, verdictText, values: anyCalculated ? values : values.length ? ["aucune valeur calculée"] : [] };
  });
}

/** The readable data block of the prompt: entered values, results per test and retained insights. */
export function renderSummaryFacts(set: SummaryInputSet): string {
  const fields = summaryFieldLines(set.values ?? {});
  const fieldBlock = fields.length
    ? fields.map((line) => `- ${line.section} › ${line.label}${line.unit ? ` (${line.unit})` : ""} : ${line.value}`)
    : ["- Aucune valeur renseignée."];
  const results = describeSummaryResults(set.results).map((result) =>
    `- ${result.label} : ${result.verdictText}${result.values.length ? ` ; ${result.values.join(" ; ")}` : ""}`);
  const insights = (set.insights ?? []).map((insight) => insight.sourceType === "rule"
    ? `- [Constat issu d’une règle] ${insight.statement}`
    : `- [Constat manuel] ${insight.text}${insight.justification ? ` (justification : ${insight.justification})` : ""}`);
  return [
    "Valeurs saisies (Section › Libellé (unité) : valeur ; les champs vides sont omis) :",
    ...fieldBlock,
    "",
    "Résultats de calcul par essai (verdicts suggérés par le calcul ; valeurs calculées arrondies au centième pour la lecture) :",
    ...results,
    "",
    "Constats retenus par le Responsable :",
    ...(insights.length ? insights : ["- Aucun constat retenu."]),
  ].join("\n");
}

const clip = (text: string, max = 280) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const joinFr = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`);

/**
 * Deterministic demonstration draft in the same five-part format as the AI draft, built from the input set only.
 * It is clearly labelled as a demonstration and states no overall conformity or approval.
 */
export function buildSummaryDemoDraft(set: SummaryInputSet): string {
  const fields = summaryFieldLines(set.values ?? {});
  const valueOf = (id: string) => fields.find((line) => line.fieldId === id)?.value;

  const context: string[] = [];
  const nature = valueOf("header.interventionNature");
  if (nature) context.push(`Intervention de type « ${nature} ».`);
  const report = valueOf("header.reportNumber");
  if (report) context.push(`Rapport n° ${report}.`);
  const equipment = ["equipment.equipment.brand", "equipment.equipment.model", "equipment.equipment.serial"].map(valueOf).filter(Boolean);
  if (equipment.length) context.push(`Appareil contrôlé : ${equipment.join(", ")}.`);
  const instruments = fields.filter((line) => line.sectionId === "instruments" && line.fieldId.endsWith(".brand")).map((line) => line.value);
  if (instruments.length) context.push(`Instruments de mesure : ${[...new Set(instruments)].join(", ")}.`);

  const checks = fields.filter((line) => VISUAL_SECTIONS.has(line.sectionId));
  const byAnswer = (answer: string) => checks.filter((line) => line.value === answer).map((line) => line.label.toLowerCase());
  const visual: string[] = [];
  if (byAnswer("Oui").length) visual.push(`Points vérifiés satisfaisants : ${joinFr(byAnswer("Oui"))}.`);
  if (byAnswer("Non").length) visual.push(`Points signalés « Non » : ${joinFr(byAnswer("Non"))}.`);
  if (byAnswer("N.A").length) visual.push(`Points non applicables : ${joinFr(byAnswer("N.A"))}.`);

  const results = describeSummaryResults(set.results);
  const measures = results.map((result) => `- ${result.label} : ${result.verdictText}${result.values.length ? ` ; ${result.values.slice(0, 3).join(" ; ")}` : ""}.`);

  const insights = (set.insights ?? []).map((insight) => `- ${clip(insight.sourceType === "rule" ? insight.statement : insight.text)}`);

  const attention: string[] = [];
  const unavailable = results.filter((result) => result.verdict === "indisponible" || result.verdict === "non calculé").map((result) => result.label);
  if (unavailable.length) attention.push(`- Verdict indisponible pour : ${joinFr(unavailable)}. Les mesures correspondantes sont à compléter ou à vérifier.`);
  const failing = results.filter((result) => result.verdict === "non-conforme").map((result) => result.label);
  if (failing.length) attention.push(`- Verdict suggéré « non-conforme » pour : ${joinFr(failing)}.`);
  if (byAnswer("Non").length) attention.push("- Au moins un contrôle visuel ou mécanique est signalé « Non ».");
  for (const comment of fields.filter((line) => COMMENT_FIELD.test(line.fieldId))) attention.push(`- ${comment.section === comment.label ? comment.label : `${comment.section} (${comment.label.toLowerCase()})`} : ${clip(comment.value)}`);
  attention.push("- La décision finale sur l’appareil appartient au Responsable.");

  return [
    "Brouillon de démonstration — généré sans IA externe à partir des données acceptées. Relisez et adaptez ce texte avant toute utilisation.",
    "",
    "Contexte de l’intervention",
    context.length ? context.join(" ") : "Aucune donnée renseignée.",
    "",
    "Contrôles visuels et mécaniques",
    visual.length ? visual.join(" ") : "Aucune donnée renseignée.",
    "",
    "Mesures et résultats",
    ...measures,
    "",
    "Constats retenus",
    ...(insights.length ? insights : ["Aucun constat retenu."]),
    "",
    "Points d’attention",
    ...attention,
  ].join("\n");
}
