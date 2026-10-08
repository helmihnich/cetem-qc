import type { PdfScanner } from "../ports/pdf-scanner.js";

/** PoV default: no antivirus is configured. The result is recorded as `not-performed` and shown to the Responsable. */
export function createNoneScanner(): PdfScanner {
  return { id: "none", scan: async () => "not-performed" };
}
