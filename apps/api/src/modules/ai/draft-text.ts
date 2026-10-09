import { SUMMARY_TEXT_MAX } from "@cetem-qc/schemas/api/v1";

/**
 * Makes provider text fit the summary text area: Markdown markers removed (bold, headings, code fences, « * » bullets
 * become « - »), blank-line runs collapsed, trimmed, and clamped to SUMMARY_TEXT_MAX so the draft can always be confirmed.
 * The wording itself is never changed.
 */
export function normalizeDraftText(raw: string, max: number = SUMMARY_TEXT_MAX): string {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/^```[^\n]*\n?/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^([ \t]*)[*•][ \t]+/gm, "$1- ")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const cut = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". "));
  return `${(cut > max * 0.6 ? head.slice(0, cut + 1) : head).trimEnd()}…`;
}
