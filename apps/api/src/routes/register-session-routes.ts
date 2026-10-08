import type express from "express";
import { apiErrorSchema, authenticationResponseSchema, passwordReplacementRequestSchema } from "@cetem-qc/schemas/api/v1";
import { InvalidCredentialsError, replacePasswordAfterAuthentication } from "../modules/identity-auth/authentication.js";
import { findActiveSession, revokeSession } from "../modules/identity-auth/sessions.js";
import type { RouteDeps } from "./route-deps.js";

export function registerSessionRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool, requireSession } = deps;
  v1.delete("/session", async (_request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    try {
      await revokeSession(getPool(), session.token);
      response.status(204).end();
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.post("/authenticate/password", requireSession, async (request, response) => {
    const parsed = passwordReplacementRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." },
      });
      return;
    }
    try {
      const currentSession = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
      const replacementSession = await replacePasswordAfterAuthentication(
        getPool(),
        currentSession.email,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      const account = replacementSession;
      const payload = authenticationResponseSchema.parse({
        token: replacementSession.token,
        sessionExpiresAt: replacementSession.expiresAt,
        user: {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          role: account.role,
          mustChangePassword: account.mustChangePassword,
        },
      });
      response.status(200).json(payload);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json(apiErrorSchema.parse({
          error: { code: "AUTHENTICATION_FAILED", message: error.message },
        }));
        return;
      }
      response.status(500).json(apiErrorSchema.parse({
        error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." },
      }));
    }
  });
}
