import { GRAPHIE_MOBILE_POV_CATALOGUE } from "../graphie-pov-catalogue";

/**
 * The catalogue fields whose raw strings differ between the local and the server values, in catalogue
 * order; a missing value counts as "". Values are compared, never merged, copied or shown. A table cell
 * is named with its paper row, as its input is (« ligne — champ »), since cell labels repeat per row.
 */
export function diffGraphieValues(local: Readonly<Record<string, string>>, server: Readonly<Record<string, string>>) {
  return GRAPHIE_MOBILE_POV_CATALOGUE.sections.flatMap((section) => {
    const rowLabelOf = new Map<string, string>();
    for (const table of section.tables ?? []) {
      table.fieldIds.forEach((row, index) => { for (const id of row) rowLabelOf.set(id, table.rowLabelsFr[index]!); });
    }
    return section.fields
      .filter((field) => (local[field.id] ?? "") !== (server[field.id] ?? ""))
      .map((field) => {
        const rowLabel = rowLabelOf.get(field.id);
        return { fieldId: field.id, labelFr: `${section.labelFr} › ${rowLabel ? `${rowLabel} — ` : ""}${field.labelFr}` };
      });
  });
}
