export const DEFAULT_API_PORT = 3001;
const LOOPBACK_API_URL = `http://127.0.0.1:${DEFAULT_API_PORT}`;

/**
 * The API origin the app talks to.
 *
 * An explicit `EXPO_PUBLIC_API_URL` always wins. Otherwise, when the bundle is served by the Expo dev server
 * (Expo Go scanning the QR code), `hostUri` is the development computer's LAN address, e.g. `192.168.1.20:8081`:
 * the API is assumed to run on that same computer. A tunnel host (`*.exp.direct`) cannot reach a LAN API, so it
 * falls back to loopback like a simulator does.
 */
export function resolveApiBaseUrl(explicitUrl: string | undefined, hostUri: string | undefined | null): string {
  const explicit = explicitUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = hostUri?.trim().replace(/^[a-z]+:\/\//i, "").split("/")[0]?.replace(/:\d+$/, "");
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".exp.direct")) return LOOPBACK_API_URL;
  return `http://${host}:${DEFAULT_API_PORT}`;
}
