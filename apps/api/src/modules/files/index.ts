// Public surface of the files module: private object storage only (Story 11.1). It imports no business module.
import { createLocalObjectStorage } from "./adapters/local-object-storage.js";
import { createMemoryObjectStorage } from "./adapters/memory-object-storage.js";
import type { ObjectStorage } from "./ports/object-storage.js";

export type { ObjectStorage } from "./ports/object-storage.js";
export { InvalidStorageKeyError, isValidStorageKey } from "./ports/object-storage.js";
export { createMemoryObjectStorage } from "./adapters/memory-object-storage.js";
export { createLocalObjectStorage } from "./adapters/local-object-storage.js";

const DEFAULT_DIRECTORY = ".data/files";

/**
 * Selects the adapter from the server environment: `FILE_STORAGE=local` (default) uses `FILE_STORAGE_DIR`
 * (default `.data/files`); `memory` keeps objects in process. Any other value fails at start-up; the message never
 * carries a path.
 */
export function createObjectStorage(env: Record<string, string | undefined>): ObjectStorage {
  const selected = env.FILE_STORAGE || "local";
  if (selected === "memory") return createMemoryObjectStorage();
  if (selected === "local") return createLocalObjectStorage(env.FILE_STORAGE_DIR || DEFAULT_DIRECTORY);
  throw new Error("FILE_STORAGE must be 'local' or 'memory'.");
}
