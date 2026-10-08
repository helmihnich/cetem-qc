import { createClamavScanner } from "./adapters/clamav-scanner.js";
import { createNoneScanner } from "./adapters/none-scanner.js";
import type { PdfScanner } from "./ports/pdf-scanner.js";
import { PDF_ABSOLUTE_MAX_BYTES } from "./validators/pdf.js";

type Env = Record<string, string | undefined>;

/**
 * Selects the scanner from the server environment: `ANTIVIRUS=none` (default) or `clamav` (`CLAMAV_HOST`, `CLAMAV_PORT`,
 * `CLAMAV_TIMEOUT_MS`). Any other value fails at start-up; the message never carries a path.
 */
export function createPdfScanner(env: Env): PdfScanner {
  const selected = env.ANTIVIRUS || "none";
  if (selected === "none") return createNoneScanner();
  if (selected === "clamav") {
    const port = Number(env.CLAMAV_PORT);
    const timeout = Number(env.CLAMAV_TIMEOUT_MS);
    return createClamavScanner({
      host: env.CLAMAV_HOST || "127.0.0.1",
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3310,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30000,
    });
  }
  throw new Error("ANTIVIRUS must be 'none' or 'clamav'.");
}

/** The configured upload limit: `PDF_MAX_BYTES` when valid, never above 20 MB (resolved OD-04). */
export function resolvePdfMaxBytes(env: Env): number {
  const value = Number(env.PDF_MAX_BYTES);
  return Number.isInteger(value) && value > 0 && value <= PDF_ABSOLUTE_MAX_BYTES ? value : PDF_ABSOLUTE_MAX_BYTES;
}
