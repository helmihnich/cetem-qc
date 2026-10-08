import assert from "node:assert/strict";
import test from "node:test";
import { fr } from "@cetem-qc/i18n";
import { SummaryProviderError, createSummaryDraftProvider } from "./index.js";
import { createGeminiSummaryProvider } from "./gemini-provider.js";
import { createMockSummaryProvider } from "./mock-provider.js";

// Story 10.1: adapters never reach the network; the gemini adapter runs on an injected fetch.

const KEY = "KEY-SECRET-VALUE";
const PROMPT = "PROMPT-SECRET-VALUE";
const signal = () => new AbortController().signal;

type Call = { url: string; init: RequestInit };
const fakeFetch = (respond: () => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(input), init: init ?? {} }); return respond(); }) as typeof fetch;
  return { calls, fetchImpl };
};
const failureOf = async (run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { return error as SummaryProviderError; }
  throw new Error("expected a failure");
};

test("A1 provider selection follows AI_PROVIDER and an unknown value warns without repeating it", () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    for (const env of [{}, { AI_PROVIDER: "" }, { AI_PROVIDER: "mock" }]) assert.equal(createSummaryDraftProvider(env as NodeJS.ProcessEnv).name, "mock");
    assert.equal(warnings.length, 0);
    assert.equal(createSummaryDraftProvider({ AI_PROVIDER: "gemini" } as NodeJS.ProcessEnv).name, "gemini");
    assert.equal(createSummaryDraftProvider({ AI_PROVIDER: "openai-secret-name" } as NodeJS.ProcessEnv).name, "mock");
    assert.equal(warnings.length, 1);
    assert.deepEqual(JSON.parse(warnings[0]!), { event: "ai.provider_unknown_fallback" });
    assert.ok(!warnings[0]!.includes("openai-secret-name"));
  } finally { console.warn = original; }
});

test("A2 the mock returns the fixed French text with model mock-fixed-text, makes no network call and states no conformity", async () => {
  const original = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = (async () => { networkCalls++; return new Response("{}"); }) as typeof fetch;
  try {
    const mock = createMockSummaryProvider();
    assert.deepEqual([mock.name, mock.model], ["mock", "mock-fixed-text"]);
    assert.equal(await mock.generate(PROMPT, { signal: signal() }), fr.summary.mockDraft);
    assert.equal(networkCalls, 0);
    assert.ok(!/machine conforme|non conforme|approuv/i.test(fr.summary.mockDraft));
  } finally { globalThis.fetch = original; }
});

test("A3 gemini sends the key as a header only, the prompt in the body, joins and trims the text parts, and uses the default or configured model", async () => {
  const body = { candidates: [{ content: { parts: [{ text: "  Début. " }, { text: "Fin.  " }] } }] };
  const { calls, fetchImpl } = fakeFetch(() => Response.json(body));
  const provider = createGeminiSummaryProvider({ GEMINI_API_KEY: KEY } as NodeJS.ProcessEnv, fetchImpl);
  assert.deepEqual([provider.name, provider.model], ["gemini", "gemini-2.5-flash"]);
  assert.equal(await provider.generate(PROMPT, { signal: signal() }), "Début. Fin.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal((calls[0]!.init.headers as Record<string, string>)["x-goog-api-key"], KEY);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { contents: [{ parts: [{ text: PROMPT }] }] });
  assert.ok(!calls[0]!.url.includes(KEY) && !String(calls[0]!.init.body).includes(KEY));
  const custom = createGeminiSummaryProvider({ GEMINI_API_KEY: KEY, GEMINI_MODEL: "gemini-test-model" } as NodeJS.ProcessEnv, fetchImpl);
  assert.equal(custom.model, "gemini-test-model");
  await custom.generate(PROMPT, { signal: signal() });
  assert.equal(calls[1]!.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
});

test("A4 gemini failures map to fixed classes and never echo the provider body, the prompt or the key", async () => {
  const env = { GEMINI_API_KEY: KEY } as NodeJS.ProcessEnv;
  const generate = (respond: () => Response | Promise<Response>, environment = env) =>
    createGeminiSummaryProvider(environment, fakeFetch(respond).fetchImpl).generate(PROMPT, { signal: signal() });

  const missing = fakeFetch(() => Response.json({}));
  const noKey = await failureOf(() => createGeminiSummaryProvider({} as NodeJS.ProcessEnv, missing.fetchImpl).generate(PROMPT, { signal: signal() }));
  assert.equal(noKey.failureClass, "not-configured");
  assert.equal(missing.calls.length, 0, "no request without a key");

  const classes: Array<[string, () => Response | Promise<Response>, string]> = [
    ["rejected fetch", () => { throw new Error(`network ${KEY} ${PROMPT}`); }, "provider-error"],
    ["HTTP error", () => new Response(`PROVIDER-SECRET-BODY ${KEY}`, { status: 500 }), "provider-error"],
    ["invalid JSON", () => new Response("PROVIDER-SECRET-BODY {", { status: 200 }), "provider-error"],
    ["non-object JSON", () => Response.json(null), "provider-error"],
    ["blank text", () => Response.json({ candidates: [{ content: { parts: [{ text: "  \n " }] } }] }), "empty-output"],
    ["no candidates", () => Response.json({ candidates: [] }), "empty-output"],
    ["non-text parts", () => Response.json({ candidates: [{ content: { parts: [{ inlineData: "x" }] } }] }), "empty-output"],
  ];
  for (const [label, respond, expected] of classes) {
    const error = await failureOf(() => generate(respond));
    assert.ok(error instanceof SummaryProviderError, label);
    assert.equal(error.failureClass, expected, label);
    assert.ok(!error.message.includes("SECRET") && !error.message.includes(KEY), label);
  }

  const controller = new AbortController();
  const aborting = createGeminiSummaryProvider(env, (async (_input: string | URL | Request, init?: RequestInit) => {
    controller.abort();
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return Response.json({});
  }) as typeof fetch);
  assert.equal((await failureOf(() => aborting.generate(PROMPT, { signal: controller.signal }))).failureClass, "timeout");
});
