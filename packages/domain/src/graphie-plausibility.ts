import { GRAPHIE_MOBILE_POV_CATALOGUE, type CatalogueField, type GraphieFormValues, type GraphiePayloadIssue } from "./graphie-catalogue.js";
import { parseGraphieReading } from "./graphie-inputs.js";

/**
 * Plausibility checks before a Graphie Mobile control is submitted (project decision, pending CETEM review).
 *
 * These are not acceptance tolerances: they only refuse values that cannot describe a real control — an impossible
 * or future date, a date before the task existed, a reading outside the physical range of a mobile radiography unit,
 * or an unreadable number — and the few fields a report cannot be issued without. Verdicts stay with the calculations.
 */
export type PlausibilityContext = {
  /** The local calendar day of the check, `YYYY-MM-DD`. */
  today: string;
  /** The earliest acceptable control date (the task's creation day), `YYYY-MM-DD`. */
  earliestDate?: string;
};

export type PlausibilityIssueCode = "required" | "invalid-date" | "future-date" | "date-before-task" | "invalid-number" | "out-of-range";

/** Fields a submitted control must carry. */
export const GRAPHIE_SUBMISSION_REQUIRED_FIELDS: readonly string[] = ["controlPerformedBy.nom", "controlPerformedBy.dateControle"];

/** Physical ranges per unit for a mobile radiography unit and its test instruments. */
export const GRAPHIE_UNIT_RANGES: Readonly<Record<string, { min: number; max: number }>> = {
  kV: { min: 20, max: 150 },
  mAs: { min: 0.1, max: 1000 },
  mA: { min: 1, max: 1000 },
  mGy: { min: 0, max: 100 },
  m: { min: 0.1, max: 5 },
  mm: { min: -100, max: 100 },
};

const catalogueFields = GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => section.fields);

/** Reads `JJ/MM/AAAA` (also `J/M/AAAA`, `-` or `.` separators) or `AAAA-MM-JJ`; undefined unless it is a real calendar day. */
export function parseControlDate(raw: string): string | undefined {
  const value = raw.trim();
  const french = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [year, month, day] = french ? [Number(french[3]), Number(french[2]), Number(french[1])]
    : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [NaN, NaN, NaN];
  if (!Number.isInteger(year) || year < 1900 || month < 1 || month > 12 || day < 1) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The local calendar day of `date` as `YYYY-MM-DD`. */
export function localIsoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fieldIssue(field: CatalogueField, raw: string, context: PlausibilityContext): PlausibilityIssueCode | undefined {
  if (raw.trim() === "") return undefined;
  if (field.type === "date") {
    const day = parseControlDate(raw);
    if (!day) return "invalid-date";
    if (day > context.today) return "future-date";
    if (context.earliestDate && day < context.earliestDate) return "date-before-task";
    return undefined;
  }
  if (field.type === "number") {
    const reading = parseGraphieReading(raw);
    if (reading === null) return undefined;
    if (!Number.isFinite(reading)) return "invalid-number";
    const range = field.unit ? GRAPHIE_UNIT_RANGES[field.unit] : undefined;
    if (range && (reading < range.min || reading > range.max)) return "out-of-range";
  }
  return undefined;
}

/**
 * Issues for the given values, as `{ path: "values.<fieldId>", code }` like the structural validator.
 * `requireMandatory` adds the missing-field issues (shown on a submission attempt, not while typing).
 */
export function checkGraphiePlausibility(values: GraphieFormValues, context: PlausibilityContext, options: { requireMandatory?: boolean } = {}): GraphiePayloadIssue[] {
  const issues: GraphiePayloadIssue[] = [];
  for (const field of catalogueFields) {
    const raw = values[field.id] ?? "";
    const code = options.requireMandatory && raw.trim() === "" && GRAPHIE_SUBMISSION_REQUIRED_FIELDS.includes(field.id)
      ? "required" : fieldIssue(field, raw, context);
    if (code) issues.push({ path: `values.${field.id}`, code });
  }
  return issues;
}

/** The allowed range of a numeric field, for help texts; undefined when its unit has none. */
export function graphieFieldRange(field: Pick<CatalogueField, "type" | "unit">): { min: number; max: number } | undefined {
  return field.type === "number" && field.unit ? GRAPHIE_UNIT_RANGES[field.unit] : undefined;
}
