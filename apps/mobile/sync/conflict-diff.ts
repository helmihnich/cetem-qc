import { GRAPHIE_MOBILE_POV_CATALOGUE } from "../graphie-pov-catalogue";

/**
 * Every catalogue field with its French name, in catalogue order: « section › champ ». A table cell is named
 * with its paper row, as its input is (« section › ligne — champ »), since cell labels repeat per row.
 */
export const GRAPHIE_FIELD_LABELS: readonly { fieldId: string; labelFr: string }[] = GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => {
  const rowLabelOf = new Map<string, string>();
  for (const table of section.tables ?? []) {
    table.fieldIds.forEach((row, index) => { for (const id of row) rowLabelOf.set(id, table.rowLabelsFr[index]!); });
  }
  return section.fields.map((field) => {
    const rowLabel = rowLabelOf.get(field.id);
    return { fieldId: field.id, labelFr: `${section.labelFr} › ${rowLabel ? `${rowLabel} — ` : ""}${field.labelFr}` };
  });
});

/**
 * The catalogue fields whose raw strings differ between the local and the server values, in catalogue
 * order; a missing value counts as "". Values are compared, never merged, copied or shown.
 */
export function diffGraphieValues(local: Readonly<Record<string, string>>, server: Readonly<Record<string, string>>) {
  return GRAPHIE_FIELD_LABELS.filter(({ fieldId }) => (local[fieldId] ?? "") !== (server[fieldId] ?? ""));
}
