import type express from "express";
import type { Pool } from "pg";

/** Shared collaborators handed to every route registrar by `createApp`. */
export interface RouteDeps {
  getPool: () => Pool;
  unauthorized: (response: express.Response) => void;
  bearerToken: (authorization: string | undefined) => string | undefined;
  requireSession: express.RequestHandler;
}
