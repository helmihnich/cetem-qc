export interface RuntimeConfig {
  host: string;
  port: number;
  /** Value for Express `trust proxy`: false (default), true, or a number of hops. */
  trustProxy: boolean | number;
  forceHttps: boolean;
}

type Env = Record<string, string | undefined>;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;

/**
 * Database connection string from the server environment only. DATABASE_URL wins so local Docker and test setups are
 * unchanged; NEON_DATABASE_URL is the hosted alias. The message never carries a value.
 */
export function resolveDatabaseUrl(env: Env = process.env): string {
  const url = env.DATABASE_URL?.trim() || env.NEON_DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL (or NEON_DATABASE_URL) must be set before initializing the database pool.");
  return url;
}

function parseBoolean(name: string, raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be empty, "true" or "false".`);
}

/** Reads and validates HOST, PORT, TRUST_PROXY and FORCE_HTTPS. Invalid values fail with a message free of values. */
export function resolveRuntimeConfig(env: Env = process.env): RuntimeConfig {
  const host = env.HOST?.trim() || DEFAULT_HOST;
  if (!/^[A-Za-z0-9.:_-]+$/.test(host)) throw new Error("HOST is not a valid bind address.");

  const rawPort = env.PORT?.trim();
  let port = DEFAULT_PORT;
  if (rawPort) {
    port = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const rawProxy = env.TRUST_PROXY?.trim().toLowerCase() ?? "";
  let trustProxy: boolean | number;
  if (rawProxy === "" || rawProxy === "false") trustProxy = false;
  else if (rawProxy === "true") trustProxy = true;
  else if (/^\d{1,2}$/.test(rawProxy)) trustProxy = Number(rawProxy);
  else throw new Error('TRUST_PROXY must be empty, "true", "false" or a number of proxies.');

  return { host, port, trustProxy, forceHttps: parseBoolean("FORCE_HTTPS", env.FORCE_HTTPS) };
}
