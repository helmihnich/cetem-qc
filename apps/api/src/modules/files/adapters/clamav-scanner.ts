import { connect } from "node:net";
import type { PdfScanner, ScanResult } from "../ports/pdf-scanner.js";

export interface ClamavOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

const CHUNK_BYTES = 64 * 1024;

/**
 * clamd INSTREAM over TCP, without SDK. Anything but a clear `stream: OK` or `... FOUND` reply (error reply, garbage,
 * timeout, socket error, early close) is `unavailable`; the reply is never logged or returned.
 */
export function createClamavScanner(options: ClamavOptions): PdfScanner {
  return {
    id: "clamav",
    scan: (bytes) => new Promise<ScanResult>((resolve) => {
      let settled = false;
      let reply = "";
      const socket = connect({ host: options.host, port: options.port });
      const finish = (result: ScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(options.timeoutMs, () => finish("unavailable"));
      socket.on("error", () => finish("unavailable"));
      const conclude = () => {
        const text = reply.replaceAll("\0", "").trim();
        if (/^stream: OK$/.test(text)) finish("clean");
        else if (/^stream: .+ FOUND$/.test(text)) finish("threat");
        else finish("unavailable");
      };
      socket.on("data", (data) => {
        reply += data.toString("latin1");
        // A zINSTREAM reply is NUL-terminated: do not wait for the server to close the connection.
        if (reply.includes("\0")) conclude();
      });
      socket.on("close", conclude);
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
          const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    }),
  };
}
