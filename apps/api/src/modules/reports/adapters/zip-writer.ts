import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** `deflate` for text parts, `store` for already compressed media. */
  method: "deflate" | "store";
}

// 1980-01-01 00:00:00 in DOS format, so the bytes depend on the entries only.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_FLAG = 0x0800;

/** Writes a ZIP archive (local headers, central directory, end record). Deterministic for the same entries. */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data);
    const body = entry.method === "deflate" ? deflateRawSync(raw, { level: 9 }) : raw;
    const checksum = crc32(raw);
    const method = entry.method === "deflate" ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(UTF8_FLAG, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(DOS_TIME, 12);
    directory.writeUInt16LE(DOS_DATE, 14);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += local.length + name.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...chunks, centralBytes, end]));
}
