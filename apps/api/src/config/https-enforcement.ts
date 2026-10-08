import type { NextFunction, Request, Response } from "express";

const exemptPaths = new Set(["/ready", "/api/v1/health"]);
const safeHost = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/**
 * Application-level backstop for SEC-005: TLS terminates on the platform, and any request whose effective protocol
 * (honoring `trust proxy`) is plaintext is redirected (GET/HEAD) or refused (other methods).
 */
export function enforceHttps(request: Request, response: Response, next: NextFunction): void {
  if (request.protocol === "https" || exemptPaths.has(request.path)) { next(); return; }
  const host = request.headers.host;
  if ((request.method === "GET" || request.method === "HEAD") && host && safeHost.test(host)) {
    response.redirect(308, `https://${host}${request.originalUrl}`);
    return;
  }
  response.status(403).json({ error: { code: "HTTPS_REQUIRED", message: "Une connexion sécurisée (HTTPS) est obligatoire." } });
}
