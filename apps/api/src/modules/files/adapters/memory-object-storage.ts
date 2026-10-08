import { InvalidStorageKeyError, isValidStorageKey } from "../ports/object-storage.js";
import type { ObjectStorage } from "../ports/object-storage.js";

/** In-memory adapter used by tests; copies bytes in and out so callers cannot mutate stored objects. */
export function createMemoryObjectStorage(): ObjectStorage & { keys(): string[] } {
  const objects = new Map<string, Uint8Array>();
  const checked = (key: string) => { if (!isValidStorageKey(key)) throw new InvalidStorageKeyError(); return key; };
  return {
    async put(key, bytes) { objects.set(checked(key), new Uint8Array(bytes)); },
    async get(key) {
      const stored = objects.get(checked(key));
      return stored ? new Uint8Array(stored) : null;
    },
    async remove(key) { objects.delete(checked(key)); },
    keys: () => [...objects.keys()].sort(),
  };
}
