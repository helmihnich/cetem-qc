import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalObjectStorage, createMemoryObjectStorage, createObjectStorage, InvalidStorageKeyError } from "./index.js";
import type { ObjectStorage } from "./index.js";

// Story 11.1 (S1, S2): private object storage adapters and their selection.

async function roundTrip(storage: ObjectStorage) {
  const bytes = new Uint8Array([1, 2, 3, 250]);
  assert.equal(await storage.get("reports/a.docx"), null, "a missing key reads null");
  await storage.put("reports/a.docx", bytes);
  assert.deepEqual([...(await storage.get("reports/a.docx"))!], [1, 2, 3, 250]);
  await storage.put("reports/a.docx", new Uint8Array([9]));
  assert.deepEqual([...(await storage.get("reports/a.docx"))!], [9], "put replaces atomically");
  await storage.remove("reports/a.docx");
  assert.equal(await storage.get("reports/a.docx"), null);
  await storage.remove("reports/a.docx");
  await storage.remove("reports/never-there.docx");
  for (const key of ["../x", "/abs", "a/../b", "a\\b", "a//b", "", "Upper/case", "a/./b", "a..b", "reports/"]) {
    await assert.rejects(storage.put(key, bytes), InvalidStorageKeyError, key);
    await assert.rejects(storage.get(key), InvalidStorageKeyError, key);
    await assert.rejects(storage.remove(key), InvalidStorageKeyError, key);
  }
}

test("S1 local object storage: round trip, atomic write, traversal rejected, idempotent remove", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cetem-files-"));
  try {
    const nested = path.join(directory, "not", "yet", "created");
    await roundTrip(createLocalObjectStorage(nested));
    const storage = createLocalObjectStorage(nested);
    await storage.put("reports/b.docx", new Uint8Array([7]));
    const leftovers = (await readdir(path.join(nested, "reports"))).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, [], "no temporary file remains after a write");
    assert.deepEqual((await readdir(path.join(nested, "reports"))), ["b.docx"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("S1 memory object storage has the same behaviour and copies bytes", async () => {
  const storage = createMemoryObjectStorage();
  await roundTrip(storage);
  const bytes = new Uint8Array([1, 2]);
  await storage.put("reports/c.docx", bytes);
  bytes[0] = 99;
  assert.deepEqual([...(await storage.get("reports/c.docx"))!], [1, 2]);
  assert.deepEqual(storage.keys(), ["reports/c.docx"]);
});

test("S2 selection from the environment: local by default, memory on request, unknown fails without a path", () => {
  assert.ok(createObjectStorage({}));
  assert.ok(createObjectStorage({ FILE_STORAGE: "" }));
  assert.ok(createObjectStorage({ FILE_STORAGE: "local", FILE_STORAGE_DIR: "some/private/place" }));
  const memory = createObjectStorage({ FILE_STORAGE: "memory", FILE_STORAGE_DIR: "ignored" });
  assert.equal(typeof (memory as unknown as { keys?: unknown }).keys, "function");
  assert.throws(() => createObjectStorage({ FILE_STORAGE: "s3", FILE_STORAGE_DIR: "some/private/place" }), (error: Error) => {
    assert.match(error.message, /FILE_STORAGE/);
    assert.ok(!error.message.includes("some/private/place"));
    return true;
  });
});
