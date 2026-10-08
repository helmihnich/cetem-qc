import express from "express";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { apiErrorSchema } from "@cetem-qc/schemas/api/v1";
import { findActiveSession } from "./modules/identity-auth/sessions.js";
import { registerDefaultSummaryReopenParticipants } from "./register-participants.js";
import type { RouteDeps } from "./routes/route-deps.js";
import { registerPublicAuthRoutes } from "./routes/register-public-auth-routes.js";
import { registerSessionRoutes } from "./routes/register-session-routes.js";
import { registerEmployeeRoutes } from "./routes/register-employee-routes.js";
import { registerTaskRoutes } from "./routes/register-task-routes.js";
import { registerEmployeeTaskRoutes } from "./routes/register-employee-task-routes.js";
import { registerEvidenceRoutes } from "./routes/register-evidence-routes.js";
import { registerSummaryRoutes } from "./routes/register-summary-routes.js";
import { registerConformityRoutes } from "./routes/register-conformity-routes.js";
import { registerReportRoutes } from "./routes/register-report-routes.js";

export function createApp(pool?: Pool) {
  registerDefaultSummaryReopenParticipants();
  const app = express();
  let sharedPool = pool;
  const getPool = () => sharedPool ??= createDatabasePool();
  app.locals.closeDatabase = async () => { if (sharedPool && sharedPool !== pool) await sharedPool.end(); };

  // Synchronization operations carry a whole form snapshot; only their two routes accept up to 256 kB.
  const defaultJson = express.json({ limit: "32kb" });
  const syncOperationJson = express.json({ limit: "256kb" });
  // Case-insensitive like Express routing, so every path that reaches the two routes gets their limit.
  const syncOperationPath = /^\/api\/v1\/employee\/tasks\/[^/]+\/(?:draft-syncs|submissions)\/?$/i;
  app.use((request, response, next) => {
    const parser = request.method === "POST" && syncOperationPath.test(request.path) ? syncOperationJson : defaultJson;
    parser(request, response, next);
  });
  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." } }));
      return;
    }
    if ((error as { type?: unknown } | null)?.type === "entity.too.large") {
      response.status(413).json(apiErrorSchema.parse({ error: { code: "PAYLOAD_TOO_LARGE", message: "Les données envoyées sont trop volumineuses." } }));
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

  const deps: RouteDeps = { getPool, unauthorized, bearerToken, requireSession };
  registerPublicAuthRoutes(v1, deps);

  // All server operations registered after the public auth flow require a live session.
  v1.use(requireSession);

  registerSessionRoutes(v1, deps);
  registerEmployeeRoutes(v1, deps);
  registerTaskRoutes(v1, deps);
  registerEmployeeTaskRoutes(v1, deps);
  registerEvidenceRoutes(v1, deps);
  registerSummaryRoutes(v1, deps);
  registerConformityRoutes(v1, deps);
  registerReportRoutes(v1, deps);

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
