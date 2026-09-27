import { z } from "zod";
import type { apiV1Components, apiV1Operations } from "@cetem-qc/types";

const healthQuerySchemaBase = z.object({
  verbose: z.enum(["true", "false"]).optional(),
});

type HealthQueryContract = apiV1Operations["getHealth"]["parameters"]["query"];
type HealthResponseContract = apiV1Components["schemas"]["HealthResponse"];
type ApiErrorContract = apiV1Components["schemas"]["ApiError"];

// Keep the runtime parser tied to the generated wire representation.
export const healthQuerySchema: z.ZodType<HealthQueryContract> = healthQuerySchemaBase;

export const healthResponseSchema: z.ZodType<HealthResponseContract> = z.object({
  status: z.literal("ok"),
  version: z.literal("v1"),
});

export const apiErrorSchema: z.ZodType<ApiErrorContract> = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export type HealthQuery = z.infer<typeof healthQuerySchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
