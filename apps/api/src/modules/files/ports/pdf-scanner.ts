export type ScanResult = "clean" | "threat" | "unavailable" | "not-performed";

/**
 * Malware scanning behind a port (AD-9). A scan that fails, times out or is incomplete is `unavailable` and is never
 * treated as clean. `not-performed` is the explicit result of the PoV `none` adapter.
 */
export interface PdfScanner {
  id: "none" | "clamav" | string;
  scan(bytes: Uint8Array): Promise<ScanResult>;
}
