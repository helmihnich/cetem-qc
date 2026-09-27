import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { apiV1Components, apiV1Operations } from "@cetem-qc/types";
import { apiErrorSchema, healthQuerySchema, healthResponseSchema } from "./v1.js";

const contractPath = fileURLToPath(new URL("../../../types/openapi/cetem-qc-v1.yaml", import.meta.url));

test("generated OpenAPI health types and runtime schemas share the wire semantics", async () => {
  type Query = apiV1Operations["getHealth"]["parameters"]["query"];
  type Response = apiV1Components["schemas"]["HealthResponse"];
  type ApiError = apiV1Components["schemas"]["ApiError"];
  const query: Query = { verbose: "true" };
  const response: Response = { status: "ok", version: "v1" };
  const apiError: ApiError = { error: { code: "VALIDATION_ERROR", message: "Invalid request", details: [{ path: "verbose", message: "Invalid value" }] } };

  assert.deepEqual(healthQuerySchema.parse(query), query);
  assert.deepEqual(healthResponseSchema.parse(response), response);
  assert.deepEqual(apiErrorSchema.parse(apiError), apiError);
  assert.equal(healthQuerySchema.safeParse({ verbose: true }).success, false);
  assert.equal(healthResponseSchema.safeParse({ status: "ok" }).success, false);
  assert.equal(apiErrorSchema.safeParse({ error: { code: "E", message: "M" } }).success, true);
  assert.equal(apiErrorSchema.safeParse({ error: { code: "E" } }).success, false);
  assert.equal(apiErrorSchema.safeParse({ error: { code: "E", message: "M", details: [{ path: "x" }] } }).success, false);
});

test("OpenAPI declares string query enum and required response fields", async () => {
  const openapi = await readFile(path.resolve(contractPath), "utf8");
  assert.match(openapi, /type: string\s+enum: \["true", "false"\]/);
  assert.match(openapi, /required: \[status, version\]/);
  assert.match(openapi, /required: \[error\][\s\S]*required: \[code, message\][\s\S]*details:[\s\S]*required: \[path, message\]/);
});
