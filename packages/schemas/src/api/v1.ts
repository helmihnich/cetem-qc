import { z } from "zod";
import type { apiV1Components, apiV1Operations } from "@cetem-qc/types";

const healthQuerySchemaBase = z.object({
  verbose: z.enum(["true", "false"]).optional(),
});

type HealthQueryContract = apiV1Operations["getHealth"]["parameters"]["query"];
type HealthResponseContract = apiV1Components["schemas"]["HealthResponse"];
type ApiErrorContract = apiV1Components["schemas"]["ApiError"];
type AuthenticationRequestContract = apiV1Operations["authenticateWithPassword"]["requestBody"]["content"]["application/json"];
type PasswordReplacementRequestContract = apiV1Operations["replaceTemporaryPassword"]["requestBody"]["content"]["application/json"];
type AuthenticationResponseContract = apiV1Operations["authenticateWithPassword"]["responses"][200]["content"]["application/json"];
type SessionResponseContract = apiV1Operations["getCurrentSession"]["responses"][200]["content"]["application/json"];

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

export const authenticationRequestSchema: z.ZodType<AuthenticationRequestContract> = z.object({ email: z.string().min(1), password: z.string().min(1) });
export const passwordReplacementRequestSchema: z.ZodType<PasswordReplacementRequestContract> = z.object({
  currentPassword: z.string().min(1), newPassword: z.string().min(1),
});
const authenticatedUserSchema = z.object({
  id: z.string(), email: z.string(), displayName: z.string(), role: z.enum(["responsable", "employe"]),
  mustChangePassword: z.boolean(),
});
const sessionTokenSchema = z.string().min(1);
export const authenticationResponseSchema: z.ZodType<AuthenticationResponseContract> = z.object({
  token: sessionTokenSchema,
  sessionExpiresAt: z.string().datetime(),
  user: authenticatedUserSchema,
});
export const sessionResponseSchema: z.ZodType<SessionResponseContract> = z.object({
  sessionExpiresAt: z.string().datetime(),
  user: authenticatedUserSchema,
});
export const sessionTokenResponseSchema = z.object({ token: sessionTokenSchema });
export type HealthQuery = z.infer<typeof healthQuerySchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type AuthenticationRequest = z.infer<typeof authenticationRequestSchema>;
export type PasswordReplacementRequest = z.infer<typeof passwordReplacementRequestSchema>;
export type AuthenticationResponse = z.infer<typeof authenticationResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type SessionTokenResponse = z.infer<typeof sessionTokenResponseSchema>;
