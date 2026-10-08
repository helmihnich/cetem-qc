import type express from "express";
import type { Pool } from "pg";
import type { ObjectStorage } from "../modules/files/index.js";

/** Shared collaborators handed to every route registrar by `createApp`. */
export interface RouteDeps {
  getPool: () => Pool;
  unauthorized: (response: express.Response) => void;
  bearerToken: (authorization: string | undefined) => string | undefined;
  requireSession: express.RequestHandler;
  /** The one object storage of the report routes (generated Word files and the official download), configured once per app. */
  reportStorage: () => ObjectStorage;
}
