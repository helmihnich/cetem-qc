import type express from "express";
import { apiErrorSchema, authenticationRequestSchema, authenticationResponseSchema, healthQuerySchema, sessionResponseSchema } from "@cetem-qc/schemas/api/v1";
import { getHealth } from "../modules/health/health-query.js";
import { authenticateWithPassword, InvalidCredentialsError } from "../modules/identity-auth/authentication.js";
import { createSession, findActiveSession, hasLiveDeactivatedSession } from "../modules/identity-auth/sessions.js";
import type { RouteDeps } from "./route-deps.js";

export function registerPublicAuthRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool, unauthorized, bearerToken } = deps;
  v1.get("/health", async (request, response) => {
    const parsed = healthQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Les paramètres de la requête sont invalides.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: "Valeur invalide.",
          })),
        },
      });
      return;
    }

    response.json(await getHealth(parsed.data));
  });

  v1.post("/authenticate", async (request, response) => {
    const parsed = authenticationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." },
      });
      return;
    }
    try {
      const account = await authenticateWithPassword(getPool(), parsed.data.email, parsed.data.password);
      const session = await createSession(getPool(), account);
      const payload = authenticationResponseSchema.parse({
        token: session.token,
        sessionExpiresAt: session.expiresAt,
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

  v1.use("/employee/tasks", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  v1.get("/session", async (request, response) => {
    const token = bearerToken(request.header("authorization"));
    if (!token) { unauthorized(response); return; }
    try {
      const session = await findActiveSession(getPool(), token);
      if (!session) {
        if (await hasLiveDeactivatedSession(getPool(), token)) {
          response.status(403).json(apiErrorSchema.parse({ error: { code: "ACCOUNT_DEACTIVATED", message: "Ce compte est désactivé." } }));
          return;
        }
        unauthorized(response);
        return;
      }
      response.status(200).json(sessionResponseSchema.parse({
        sessionExpiresAt: session.expiresAt,
        user: {
          id: session.id, email: session.email, displayName: session.displayName,
          role: session.role, mustChangePassword: session.mustChangePassword,
        },
      }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });
}
