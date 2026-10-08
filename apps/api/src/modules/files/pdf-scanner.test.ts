import assert from "node:assert/strict";
import { createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";
import test from "node:test";
import { createPdfScanner, resolvePdfMaxBytes } from "./index.js";

// Story 11.2 (S1–S3): scanner selection, the clamd INSTREAM client against a local fake server, and the size limit.

const bytes = (length: number) => new Uint8Array(Buffer.alloc(length, 7));

test("S1 none reports not-performed; selection defaults to none and an unknown value fails without a path", async () => {
  assert.equal(await createPdfScanner({}).scan(bytes(3)), "not-performed");
  assert.equal(createPdfScanner({ ANTIVIRUS: "" }).id, "none");
  assert.equal(createPdfScanner({ ANTIVIRUS: "none" }).id, "none");
  assert.equal(createPdfScanner({ ANTIVIRUS: "clamav", CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: "3310" }).id, "clamav");
  assert.throws(() => createPdfScanner({ ANTIVIRUS: "norton", CLAMAV_HOST: "secret/host" }), (error: Error) => {
    assert.match(error.message, /ANTIVIRUS/);
    assert.ok(!error.message.includes("secret"));
    return true;
  });
});

interface Fake { server: Server; port: number; received: Buffer[]; close: () => Promise<void> }

async function fakeClamd(onConnection: (socket: Socket, received: Buffer[]) => void): Promise<Fake> {
  const received: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    onConnection(socket, received);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server, received, port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}

/** Replies once the zero-length terminator chunk has arrived. */
const replyAfterTerminator = (reply: string, close = false) => (socket: Socket, received: Buffer[]) => {
  socket.on("data", (data) => {
    received.push(data);
    const all = Buffer.concat(received);
    if (all.subarray(all.length - 4).equals(Buffer.alloc(4))) {
      socket.write(reply);
      if (close) socket.end();
    }
  });
};

const scanner = (port: number, timeoutMs = 2000) => createPdfScanner({ ANTIVIRUS: "clamav", CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: String(port), CLAMAV_TIMEOUT_MS: String(timeoutMs) });

test("S2 clamd client: OK is clean, FOUND is a threat, and the protocol framing is exact for a multi-chunk payload", async () => {
  const clean = await fakeClamd(replyAfterTerminator("stream: OK\0"));
  try {
    assert.equal(await scanner(clean.port).scan(bytes(150_000)), "clean");
    const sent = Buffer.concat(clean.received);
    assert.equal(sent.subarray(0, 10).toString("latin1"), "zINSTREAM\0");
    let offset = 10;
    const lengths: number[] = [];
    for (;;) {
      const length = sent.readUInt32BE(offset);
      offset += 4;
      if (length === 0) break;
      lengths.push(length);
      offset += length;
    }
    assert.deepEqual(lengths, [65536, 65536, 150_000 - 2 * 65536]);
    assert.equal(offset, sent.length, "nothing after the zero terminator");
  } finally { await clean.close(); }

  const threat = await fakeClamd(replyAfterTerminator("stream: Eicar-Test-Signature FOUND\0", true));
  try { assert.equal(await scanner(threat.port).scan(bytes(10)), "threat"); } finally { await threat.close(); }
});

test("S2 any error, garbage reply, early close, refused connection or timeout is unavailable, never clean", async () => {
  for (const reply of ["INSTREAM size limit exceeded. ERROR\0", "garbage", "stream: OK but not really FOUND ERROR\0", "\0"]) {
    const fake = await fakeClamd(replyAfterTerminator(reply, true));
    try { assert.equal(await scanner(fake.port).scan(bytes(10)), "unavailable", reply); } finally { await fake.close(); }
  }
  const early = await fakeClamd((socket) => { socket.on("data", () => socket.destroy()); });
  try { assert.equal(await scanner(early.port).scan(bytes(10)), "unavailable"); } finally { await early.close(); }

  const closedPort = await fakeClamd(() => undefined);
  const { port } = closedPort;
  await closedPort.close();
  assert.equal(await scanner(port).scan(bytes(10)), "unavailable", "connection refused");

  const silent = await fakeClamd(() => undefined);
  try {
    const started = Date.now();
    assert.equal(await scanner(silent.port, 150).scan(bytes(10)), "unavailable", "timeout");
    assert.ok(Date.now() - started < 1500);
  } finally { await silent.close(); }
});

test("S3 the upload limit defaults to 20 MB and can only be lowered", () => {
  assert.equal(resolvePdfMaxBytes({}), 20971520);
  assert.equal(resolvePdfMaxBytes({ PDF_MAX_BYTES: "1000" }), 1000);
  for (const value of ["", "abc", "0", "-5", "1.5", "20971521", "99999999999"]) assert.equal(resolvePdfMaxBytes({ PDF_MAX_BYTES: value }), 20971520, value);
  assert.equal(resolvePdfMaxBytes({ PDF_MAX_BYTES: "20971520" }), 20971520);
});
