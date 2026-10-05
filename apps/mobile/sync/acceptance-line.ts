import { fr } from "@cetem-qc/i18n";
import type { OutboxItem } from "../local-drafts/model";

const twoDigits = (value: number) => String(value).padStart(2, "0");
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** « Soumission acceptée par le serveur le JJ/MM/AAAA à HH:MM. » in the device's local time; undefined for a missing or invalid date. */
export function formatSubmissionAcceptedLine(acceptedAt: unknown): string | undefined {
  if (typeof acceptedAt !== "string" || !ISO_DATE_TIME.test(acceptedAt)) return undefined;
  const date = new Date(acceptedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return fr.employeeTasks.submittedAt
    .replace("{date}", `${twoDigits(date.getDate())}/${twoDigits(date.getMonth() + 1)}/${date.getFullYear()}`)
    .replace("{time}", `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`);
}

/** The line for a task whose latest `submit` item was accepted by the server, from its stored outcome. */
export function submissionAcceptedLine(items: readonly OutboxItem[]): string | undefined {
  const submit = items.filter((item) => item.kind === "submit").sort((a, b) => a.sequence - b.sequence).at(-1);
  if (!submit || submit.status !== "resolved" || submit.outcome !== "accepted") return undefined;
  const detail = submit.outcomeMetadata?.detail;
  return formatSubmissionAcceptedLine(detail && typeof detail === "object" ? (detail as { acceptedAt?: unknown }).acceptedAt : undefined);
}
