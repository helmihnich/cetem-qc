/**
 * Private object storage (AD-9). Keys are opaque, server-generated and never come from user input.
 * Implementations never serve objects publicly: reads go through an authorized API endpoint.
 */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The stored bytes, or null when the key does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Idempotent: removing a missing key succeeds. */
  remove(key: string): Promise<void>;
}

/** A key is lower-case path segments of letters, digits, `_`, `-` and `.`; no traversal, no absolute path, no backslash. */
const KEY_PATTERN = /^[a-z0-9/_.-]+$/;

export function isValidStorageKey(key: string): boolean {
  if (!KEY_PATTERN.test(key) || key.startsWith("/") || key.endsWith("/")) return false;
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.includes(".."));
}

export class InvalidStorageKeyError extends Error {
  constructor() {
    super("The storage key is not valid.");
    this.name = "InvalidStorageKeyError";
  }
}
