import express from "express";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { apiErrorSchema } from "@cetem-qc/schemas/api/v1";
import { enforceHttps } from "./config/https-enforcement.js";
import { resolveDatabaseUrl, resolveRuntimeConfig } from "./config/runtime-config.js";
import type { RuntimeConfig } from "./config/runtime-config.js";
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
import { registerHistoryRoutes } from "./routes/register-history-routes.js";
import { createObjectStorage } from "./modules/files/index.js";
import type { ObjectStorage } from "./modules/files/index.js";
import { reportCommandTestSeams } from "./modules/reports/index.js";
import { registerFileRoutes } from "./routes/register-file-routes.js";
import { createDisabledMailer, createMailer, sendTemporaryCredentialEmail } from "./modules/notifications/mailer.js";
import type { Mailer } from "./modules/notifications/mailer.js";

export interface AppOptions {
  /** Defaults to the process environment (TRUST_PROXY, FORCE_HTTPS); tests pass explicit values. */
  runtime?: Pick<RuntimeConfig, "trustProxy" | "forceHttps">;
  /** Defaults to the SMTP settings of the process environment (disabled when SMTP_HOST is empty). */
  mailer?: Mailer;
}

export function createApp(pool?: Pool, options: AppOptions = {}) {
  registerDefaultSummaryReopenParticipants();
  const runtime = options.runtime ?? resolveRuntimeConfig(process.env);
  const app = express();
  app.set("trust proxy", runtime.trustProxy);
  if (runtime.forceHttps) app.use(enforceHttps);
  let sharedPool = pool;
  const getPool = () => sharedPool ??= createDatabasePool();
  app.locals.closeDatabase = async () => { if (sharedPool && sharedPool !== pool) await sharedPool.end(); };

  // Readiness (unlike /api/v1/health liveness) proves the database answers. Public, no secrets, outside the contract.
  app.get("/ready", async (_request, response) => {
    try {
      await getPool().query("SELECT 1");
      response.status(200).json({ status: "ready" });
    } catch {
      console.error("readiness_check_failed", "database_unavailable");
      response.status(503).json({ status: "unavailable" });
    }
  });

  // Synchronization operations carry a whole form snapshot; only their two routes accept up to 256 kB.
  const defaultJson = express.json({ limit: "32kb" });
  const syncOperationJson = express.json({ limit: "256kb" });
  // Case-insensitive like Express routing, so every path that reaches the two routes gets their limit.
  const syncOperationPath = /^\/api\/v1\/employee\/tasks\/[^/]+\/(?:draft-syncs|submissions)\/?$/i;
  // The raw PDF upload (Story 11.2) is parsed by its own route after the role, ownership, size and type checks, so a
  // body of any declared type must reach it unparsed and be answered there (415 instead of a JSON syntax error).
  const binaryUploadPath = /^\/api\/v1\/tasks\/[^/]+\/pdf-files\/?$/i;
  app.use((request, response, next) => {
    if (request.method === "POST" && binaryUploadPath.test(request.path)) { next(); return; }
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

  let configuredReportStorage: ObjectStorage | undefined;
  const reportStorage = () => reportCommandTestSeams.storage ?? (configuredReportStorage ??= createObjectStorage(process.env));
  let configuredMailer = options.mailer;
  const mailer = () => configuredMailer ??= (() => {
    try { return createMailer(process.env); } catch { console.error("mailer_config_invalid"); return createDisabledMailer(); }
  })();
  const loginUrl = process.env.APP_LOGIN_URL?.trim() || undefined;
  const notifyTemporaryCredential: RouteDeps["notifyTemporaryCredential"] = (employee, temporaryCredential, reason) =>
    sendTemporaryCredentialEmail(mailer(), { employee, temporaryCredential, reason, loginUrl });
  const deps: RouteDeps = { getPool, unauthorized, bearerToken, requireSession, reportStorage, notifyTemporaryCredential };
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
  registerHistoryRoutes(v1, deps);
  registerFileRoutes(v1, deps);

  app.use("/api/v1", v1);
  return app;
}

function createDatabasePool(): Pool {
  const connectionString = resolveDatabaseUrl(process.env);
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

if (typeof require !== "undefined" && require.main === module) {
  const config = resolveRuntimeConfig(process.env);
  const app = createApp(undefined, { runtime: config });
  const server = app.listen(config.port, config.host, () => {
    console.log(`CETEM-QC API listening on ${config.host}:${config.port}`);
  });
  const shutdown = () => {
    void shutdownApplication(server, app.locals.closeDatabase).then(handleShutdownFailures);
    // server.close() waits for keep-alive connections (the web proxy holds some open), which left the port taken
    // after Ctrl+C or a watch restart. Idle ones are closed now; requests still running get 5 seconds.
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
