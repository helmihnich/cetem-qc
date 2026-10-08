import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";

/** Test-only independent ZIP reader: parses the central directory and verifies every CRC-32 and size. */
export function readZip(bytes: Uint8Array): Map<string, Buffer> {
  const buffer = Buffer.from(bytes);
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(endOffset >= 0, "end of central directory");
  const entries = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const parts = new Map<string, Buffer>();
  for (let index = 0; index < entries; index++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const stored = buffer.subarray(dataStart, dataStart + compressed);
    const data = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
    assert.equal(data.length, size, name);
    assert.equal(crc32(data), checksum, `CRC-32 of ${name}`);
    parts.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}
