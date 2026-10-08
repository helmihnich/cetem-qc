import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { InvalidStorageKeyError, isValidStorageKey } from "../ports/object-storage.js";
import type { ObjectStorage } from "../ports/object-storage.js";

/**
 * Local filesystem adapter. The root directory is private (outside any served directory); keys are validated so a key
 * can never leave it. Writes are atomic: a temporary file is written, then renamed over the final name.
 */
export function createLocalObjectStorage(rootDirectory: string): ObjectStorage {
  const root = path.resolve(rootDirectory);
  const resolve = (key: string): string => {
    if (!isValidStorageKey(key)) throw new InvalidStorageKeyError();
    const target = path.resolve(root, ...key.split("/"));
    if (!target.startsWith(root + path.sep)) throw new InvalidStorageKeyError();
    return target;
  };
  return {
    async put(key, bytes) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes);
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(resolve(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
