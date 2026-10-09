import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiBaseUrl } from "./api-base-url.js";

test("an explicit EXPO_PUBLIC_API_URL wins and loses its trailing slash", () => {
  assert.equal(resolveApiBaseUrl("https://api.example.test/", "192.168.1.20:8081"), "https://api.example.test");
});

test("Expo Go on a LAN reaches the API on the development computer", () => {
  assert.equal(resolveApiBaseUrl(undefined, "192.168.1.20:8081"), "http://192.168.1.20:3001");
  assert.equal(resolveApiBaseUrl("  ", "exp://10.0.0.5:8081"), "http://10.0.0.5:3001");
});

test("loopback, tunnel or unknown dev hosts fall back to the loopback API", () => {
  assert.equal(resolveApiBaseUrl(undefined, undefined), "http://127.0.0.1:3001");
  assert.equal(resolveApiBaseUrl(undefined, "localhost:8081"), "http://127.0.0.1:3001");
  assert.equal(resolveApiBaseUrl(undefined, "abc-anonymous-8081.exp.direct"), "http://127.0.0.1:3001");
});
