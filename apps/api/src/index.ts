import express from "express";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { apiErrorSchema, authenticationRequestSchema, authenticationResponseSchema, createEmployeeRequestSchema, employeeCredentialResponseSchema, employeeListResponseSchema, healthQuerySchema, passwordReplacementRequestSchema, sessionResponseSchema, updateEmployeeStatusRequestSchema, updateEmployeeStatusResponseSchema } from "@cetem-qc/schemas/api/v1";
import { getHealth } from "./modules/health/health-query.js";
import {
  authenticateWithPassword,
  InvalidCredentialsError,
  replacePasswordAfterAuthentication,
} from "./modules/identity-auth/authentication.js";
import { createSession, findActiveSession, revokeSession } from "./modules/identity-auth/sessions.js";
import { listOwnTeamEmployees } from "./modules/team-access/queries/list-own-team-employees.js";
import { createOwnTeamEmployee, DuplicateEmployeeEmailError, regenerateOwnTeamEmployeeCredential, updateOwnTeamEmployeeStatus } from "./modules/team-access/employee-credentials.js";

export function createApp(pool?: Pool) {
  const app = express();
  let sharedPool = pool;
  const getPool = () => sharedPool ??= createDatabasePool();
  app.locals.closeDatabase = async () => { if (sharedPool && sharedPool !== pool) await sharedPool.end(); };

  app.use(express.json({ limit: "32kb" }));
  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." } }));
      return;
    }
    next(error);
  });
  const v1 = express.Router();

  const unauthorized = (response: express.Response) => {
    response.status(401).json(apiErrorSchema.parse({
      error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." },
    }));
  };

  const bearerToken = (authorization: string | undefined): string | undefined => {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
    return match?.[1];
  };

  const requireSession = async (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const token = bearerToken(request.header("authorization"));
    if (!token) { unauthorized(response); return; }
    try {
      const session = await findActiveSession(getPool(), token);
      if (!session) { unauthorized(response); return; }
      const allowedDuringActivation = request.method === "GET" && request.path === "/session"
        || request.method === "DELETE" && request.path === "/session"
        || request.method === "POST" && request.path === "/authenticate/password";
      if (session.mustChangePassword && !allowedDuringActivation) { unauthorized(response); return; }
      response.locals.session = session;
      next();
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  };

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

  // All server operations registered after the public auth flow require a live session.
  v1.use(requireSession);

  v1.get("/session", (request, response) => {
    const session = response.locals.session as Awaited<ReturnType<typeof findActiveSession>>;
    if (!session) { unauthorized(response); return; }
    response.status(200).json(sessionResponseSchema.parse({
      sessionExpiresAt: session.expiresAt,
      user: {
        id: session.id, email: session.email, displayName: session.displayName,
        role: session.role, mustChangePassword: session.mustChangePassword,
      },
    }));
  });

  v1.delete("/session", async (_request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    try {
      await revokeSession(getPool(), session.token);
      response.status(204).end();
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.get("/employees", async (_request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({
        error: { code: "FORBIDDEN", message: "Accès réservé au responsable de l’équipe." },
      }));
      return;
    }
    try {
      const employees = await listOwnTeamEmployees(getPool(), session.id);
      response.status(200).json(employeeListResponseSchema.parse({ employees }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({
        error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." },
      }));
    }
  });

  v1.post("/employees", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "AccÃ¨s rÃ©servÃ© au responsable de lâ€™Ã©quipe." } }));
      return;
    }
    const parsed = createEmployeeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Le prÃ©nom, le nom et une adresse e-mail valide sont requis.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
      return;
    }
    try {
      const result = await createOwnTeamEmployee(getPool(), session.id, parsed.data);
      response.status(201).set("Cache-Control", "no-store").json(employeeCredentialResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof DuplicateEmployeeEmailError) {
        response.status(409).json(apiErrorSchema.parse({ error: { code: "EMAIL_ALREADY_EXISTS", message: "Cette adresse e-mail est dÃ©jÃ  utilisÃ©e." } }));
        return;
      }
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.post("/employees/:employeeId/credential", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "AccÃ¨s rÃ©servÃ© au responsable de lâ€™Ã©quipe." } }));
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.params.employeeId ?? "")) {
      response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "EmployÃ© introuvable ou dÃ©jÃ  activÃ©." } }));
      return;
    }
    try {
      const result = await regenerateOwnTeamEmployeeCredential(getPool(), session.id, request.params.employeeId!);
      if (!result) {
        response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "EmployÃ© introuvable ou dÃ©jÃ  activÃ©." } }));
        return;
      }
      response.status(200).set("Cache-Control", "no-store").json(employeeCredentialResponseSchema.parse(result));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.patch("/employees/:employeeId/status", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Action réservée au responsable de l’équipe." } }));
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.params.employeeId ?? "")) {
      response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Employé introuvable dans votre équipe." } }));
      return;
    }
    const parsed = updateEmployeeStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Le statut demandé est invalide.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
      return;
    }
    try {
      const employee = await updateOwnTeamEmployeeStatus(getPool(), session.id, request.params.employeeId!, parsed.data.active);
      if (!employee) {
        response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Employé introuvable dans votre équipe." } }));
        return;
      }
      response.status(200).set("Cache-Control", "no-store").json(updateEmployeeStatusResponseSchema.parse({ employee }));
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

  app.use("/api/v1", v1);
  return app;
}

function createDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be set before handling authentication requests.");
  // Loaded lazily so health checks and isolated route construction do not require database configuration.
  const { Pool: PgPool } = require("pg") as typeof import("pg");
  const pool = new PgPool({ connectionString });
  pool.on("error", (error) => console.error("Unexpected PostgreSQL pool error", error));
  return pool;
}

export async function shutdownApplication(
  server: Pick<Server, "close">,
  closeDatabase: () => Promise<void>,
): Promise<Array<{ message: string; error: unknown }>> {
  const failures: Array<{ message: string; error: unknown }> = [];

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  } catch (error) {
    failures.push({ message: "HTTP server shutdown failed", error });
  }

  try {
    await closeDatabase();
  } catch (error) {
    failures.push({ message: "PostgreSQL pool shutdown failed", error });
  }

  return failures;
}

function handleShutdownFailures(failures: Array<{ message: string; error: unknown }>): void {
  for (const { message, error } of failures) {
    reportShutdownError(message, error);
    if (process.exitCode === undefined) process.exitCode = 1;
  }
}

function reportShutdownError(message: string, error: unknown): void {
  try {
    console.error(message, error);
  } catch {
    // Shutdown reporting must not prevent remaining cleanup.
  }
}

const port = Number(process.env.PORT ?? 3001);
if (typeof require !== "undefined" && require.main === module) {
  const app = createApp();
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`CETEM-QC API listening on http://127.0.0.1:${port}/api/v1`);
  });
  const shutdown = () => {
    void shutdownApplication(server, app.locals.closeDatabase).then(handleShutdownFailures);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
