export type PdfRejectionClass = "not-pdf" | "truncated" | "corrupt-structure" | "encrypted";

export type PdfValidation =
  | { result: "passed" }
  | { result: "rejected"; class: PdfRejectionClass }
  | { result: "quarantined"; class: "active-content" };

/** Largest file the server ever accepts (resolved OD-04); configuration can only lower it. */
export const PDF_ABSOLUTE_MAX_BYTES = 20 * 1024 * 1024;

// Name tokens that make a file unsafe to keep available. A security policy of this build, not a CETEM business rule.
const ACTIVE_CONTENT_TOKENS = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia", "/SubmitForm", "/ImportData", "/GoToR", "/GoToE"] as const;
const TRAILER_WINDOW = 64 * 1024;

const isNameCharacter = (code: number | undefined): boolean =>
  code !== undefined && !(code <= 0x20 || code === 0x2f || code === 0x3c || code === 0x3e || code === 0x28 || code === 0x29 || code === 0x5b || code === 0x5d || code === 0x7b || code === 0x7d || code === 0x25);

function hasName(text: string, token: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(token, from);
    if (at < 0) return false;
    if (!isNameCharacter(text.charCodeAt(at + token.length) || undefined)) return true;
    from = at + 1;
  }
}

/**
 * Validates a PDF on its raw bytes only (no parser dependency, no I/O). The first matching class wins, in this order:
 * not a PDF, truncated, corrupt structure, encrypted, then active content (quarantined, not rejected). Tokens hidden
 * in compressed object streams are not visible here: the malware scanner is the second line.
 */
export function validatePdf(bytes: Uint8Array, options: { maxBytes: number }): PdfValidation {
  if (bytes.length === 0 || bytes.length > options.maxBytes) return { result: "rejected", class: "corrupt-structure" };
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");

  if (!/^%PDF-[12]\.\d/.test(text)) return { result: "rejected", class: "not-pdf" };
  if (!text.slice(-1024).includes("%%EOF")) return { result: "rejected", class: "truncated" };

  const tail = text.slice(-2048);
  const startxrefs = [...tail.matchAll(/startxref\s+(\d+)/g)];
  const last = startxrefs[startxrefs.length - 1];
  if (!last) return { result: "rejected", class: "corrupt-structure" };
  const offset = Number(last[1]);
  if (!Number.isSafeInteger(offset) || offset >= text.length) return { result: "rejected", class: "corrupt-structure" };
  const atOffset = text.slice(offset, offset + 64);
  const isXrefTable = /^xref(?![A-Za-z])/.test(atOffset);
  const isXrefObject = /^\d+\s+\d+\s+obj\b/.test(atOffset);
  if (!isXrefTable && !isXrefObject) return { result: "rejected", class: "corrupt-structure" };

  // The trailer dictionary (classic table) or the cross-reference stream dictionary carries /Root and /Encrypt.
  const region = text.slice(Math.max(0, text.length - TRAILER_WINDOW));
  const trailerAt = isXrefTable ? region.lastIndexOf("trailer") : -1;
  const trailer = isXrefTable
    ? (trailerAt >= 0 ? region.slice(trailerAt) : "")
    : text.slice(offset, offset + TRAILER_WINDOW).split("stream")[0] ?? "";
  if (!hasName(trailer, "/Root")) return { result: "rejected", class: "corrupt-structure" };
  if (/\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(trailer)) return { result: "rejected", class: "encrypted" };

  for (const token of ACTIVE_CONTENT_TOKENS) {
    if (hasName(text, token)) return { result: "quarantined", class: "active-content" };
  }
  return { result: "passed" };
}
