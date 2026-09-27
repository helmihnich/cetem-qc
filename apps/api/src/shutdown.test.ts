import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server } from "node:http";
import { shutdownApplication } from "./index.js";

function serverThatCloses(callbackError?: Error): Pick<Server, "close"> {
  return {
    close: (callback: ((error?: Error) => void) | undefined) => { callback?.(callbackError); },
  } as unknown as Pick<Server, "close">;
}

test("shutdown waits for HTTP server closure before closing the pool", async () => {
  let finishServerClose!: () => void;
  let poolCloseInvoked = false;
  const server = {
    close: (callback: ((error?: Error) => void) | undefined) => {
      finishServerClose = () => callback?.();
    },
  } as unknown as Pick<Server, "close">;

  const shutdown = shutdownApplication(server, async () => { poolCloseInvoked = true; });
  await Promise.resolve();
  assert.equal(poolCloseInvoked, false);

  finishServerClose();
  await shutdown;
  assert.equal(poolCloseInvoked, true);
});

test("shutdown awaits owned database pool closure", async () => {
  let finishClose!: () => void;
  let closeInvoked = false;
  let shutdownFinished = false;
  const poolClose = new Promise<void>((resolve) => { finishClose = resolve; });

  const shutdown = shutdownApplication(serverThatCloses(), () => {
    closeInvoked = true;
    return poolClose;
  }).then(() => { shutdownFinished = true; });

  await Promise.resolve();
  assert.equal(closeInvoked, true);
  assert.equal(shutdownFinished, false);

  finishClose();
  await shutdown;
  assert.equal(shutdownFinished, true);
});

test("shutdown handles pool close rejection without rejecting or leaking it", async () => {
  const failures = await shutdownApplication(
    serverThatCloses(),
    async () => { throw new Error("pool close failure"); },
  );

  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.message, "PostgreSQL pool shutdown failed");
  assert.match(String(failures[0]?.error), /pool close failure/);
});

test("pool close failure does not replace an existing server shutdown failure", async () => {
  const failures = await shutdownApplication(
    serverThatCloses(new Error("server close failure")),
    async () => { throw new Error("pool close failure"); },
  );

  assert.deepEqual(failures.map(({ message }) => message), [
    "HTTP server shutdown failed",
    "PostgreSQL pool shutdown failed",
  ]);
  assert.match(String(failures[0]?.error), /server close failure/);
  assert.match(String(failures[1]?.error), /pool close failure/);
});
