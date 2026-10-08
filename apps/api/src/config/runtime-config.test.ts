import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { createApp } from "../index.js";
import { resolveDatabaseUrl, resolveRuntimeConfig } from "./runtime-config.js";

test("resolveDatabaseUrl prefers DATABASE_URL, falls back to NEON_DATABASE_URL, and never leaks values", () => {
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "postgres://a", NEON_DATABASE_URL: "postgres://b" }), "postgres://a");
  assert.equal(resolveDatabaseUrl({ DATABASE_URL: "", NEON_DATABASE_URL: "postgres://b" }), "postgres://b");
  assert.throws(() => resolveDatabaseUrl({ DATABASE_URL: " ", NEON_DATABASE_URL: "" }), /must be set/);
});

test("resolveRuntimeConfig applies defaults and parses HOST, PORT, TRUST_PROXY and FORCE_HTTPS", () => {
  assert.deepEqual(resolveRuntimeConfig({}), { host: "127.0.0.1", port: 3001, trustProxy: false, forceHttps: false });
  assert.deepEqual(
    resolveRuntimeConfig({ HOST: "0.0.0.0", PORT: "10000", TRUST_PROXY: "true", FORCE_HTTPS: "true" }),
    { host: "0.0.0.0", port: 10000, trustProxy: true, forceHttps: true },
  );
  assert.equal(resolveRuntimeConfig({ TRUST_PROXY: "2" }).trustProxy, 2);
});

test("resolveRuntimeConfig rejects invalid values without echoing them", () => {
  for (const env of [{ PORT: "abc-secret" }, { PORT: "70000" }, { TRUST_PROXY: "maybe-secret" }, { FORCE_HTTPS: "yes-secret" }, { HOST: "bad host;secret" }]) {
    assert.throws(() => resolveRuntimeConfig(env), (error: Error) => !error.message.includes("secret"));
  }
});

async function withApp(pool: Pool | undefined, runtime: { trustProxy: boolean | number; forceHttps: boolean }, run: (root: string) => Promise<void>) {
  const server = createApp(pool, { runtime }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

const healthyPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
const failingPool = { query: async () => { throw new Error("connect ECONNREFUSED db.private.host postgres://u:pw@h/db"); } } as unknown as Pool;

test("/ready answers 200 with a healthy pool and 503 without error text when the pool fails", async () => {
  await withApp(healthyPool, { trustProxy: false, forceHttps: false }, async (root) => {
    const response = await fetch(`${root}/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready" });
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    await withApp(failingPool, { trustProxy: false, forceHttps: false }, async (root) => {
      const response = await fetch(`${root}/ready`);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), { status: "unavailable" });
      assert.ok(!/ECONNREFUSED|postgres|private/.test(text));
    });
  } finally { console.error = originalError; }
});

test("FORCE_HTTPS redirects plaintext GET, refuses plaintext POST and keeps probes reachable", async () => {
  await withApp(healthyPool, { trustProxy: false, forceHttps: true }, async (root) => {
    assert.equal((await fetch(`${root}/ready`)).status, 200);
    assert.equal((await fetch(`${root}/api/v1/health`)).status, 200);
    const redirect = await fetch(`${root}/api/v1/session`, { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), `https://${root.slice("http://".length)}/api/v1/session`);
    const post = await fetch(`${root}/api/v1/authenticate/password`, { method: "POST" });
    assert.equal(post.status, 403);
    assert.equal(((await post.json()) as { error: { code: string } }).error.code, "HTTPS_REQUIRED");
    // Without trust proxy the forwarded protocol header is ignored.
    const spoofed = await fetch(`${root}/api/v1/session`, { redirect: "manual", headers: { "x-forwarded-proto": "https" } });
    assert.equal(spoofed.status, 308);
  });
  await withApp(healthyPool, { trustProxy: true, forceHttps: true }, async (root) => {
    const forwarded = await fetch(`${root}/api/v1/session`, { redirect: "manual", headers: { "x-forwarded-proto": "https" } });
    assert.equal(forwarded.status, 401);
  });
});

test("without FORCE_HTTPS plaintext behaves as before", async () => {
  await withApp(healthyPool, { trustProxy: false, forceHttps: false }, async (root) => {
    assert.equal((await fetch(`${root}/api/v1/session`, { redirect: "manual" })).status, 401);
  });
});
