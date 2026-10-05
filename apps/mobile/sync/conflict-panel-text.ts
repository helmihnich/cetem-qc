import { fr } from "@cetem-qc/i18n";
import type { LocalDraft } from "../local-drafts/model";

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** JJ/MM/AAAA and HH:MM in the device's local time; undefined for an invalid date. */
export function localDateTime(value: number | string): { date: string; time: string } | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    date: `${twoDigits(date.getDate())}/${twoDigits(date.getMonth() + 1)}/${date.getFullYear()}`,
    time: `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`,
  };
}

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

/** « Version locale : révision R, enregistrée le JJ/MM/AAAA à HH:MM ». */
export function localVersionLine(draft: Pick<LocalDraft, "revision" | "savedAt">): string | undefined {
  const at = localDateTime(draft.savedAt);
  return at ? fill(fr.employeeTasks.conflictLocalVersion, { revision: String(draft.revision), ...at }) : undefined;
}

/** Server version metadata, as stored with a 409 (`current`) or returned by the current-version read. */
export type ServerVersionMetadata = {
  revision: number;
  state: "draft" | "submitted";
  lastChangedAt: string | null;
  lastChangedBy: { id: string; displayName: string } | null;
};

/** Reads stored 409 metadata defensively; anything else gives undefined, so nothing is invented. */
export function parseServerVersionMetadata(value: unknown): ServerVersionMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const meta = value as Record<string, unknown>;
  const by = meta.lastChangedBy as Record<string, unknown> | null | undefined;
  if (!Number.isSafeInteger(meta.revision) || Number(meta.revision) < 0 || (meta.state !== "draft" && meta.state !== "submitted")) return undefined;
  if (meta.lastChangedAt !== null && typeof meta.lastChangedAt !== "string") return undefined;
  if (by !== null && (!by || typeof by !== "object" || typeof by.id !== "string" || typeof by.displayName !== "string")) return undefined;
  return {
    revision: Number(meta.revision), state: meta.state, lastChangedAt: meta.lastChangedAt as string | null,
    lastChangedBy: by ? { id: by.id as string, displayName: by.displayName as string } : null,
  };
}

/**
 * One server version line: `conflictServerAtConflict` for the stored 409 metadata, `conflictServerVersion`
 * for the fetched one. A version without audit (or without its date or author) reads `conflictServerNone`.
 */
export function serverVersionLine(meta: ServerVersionMetadata, kind: "at-conflict" | "current"): string {
  const at = meta.lastChangedAt ? localDateTime(meta.lastChangedAt) : undefined;
  if (meta.revision === 0 || !at || !meta.lastChangedBy) return fr.employeeTasks.conflictServerNone;
  const values = {
    revision: String(meta.revision), ...at, author: meta.lastChangedBy.displayName,
    state: meta.state === "submitted" ? fr.employeeTasks.submitted : fr.employeeTasks.draft,
  };
  return fill(kind === "current" ? fr.employeeTasks.conflictServerVersion : fr.employeeTasks.conflictServerAtConflict, values);
}
