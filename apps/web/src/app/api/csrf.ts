import { NextResponse } from "next/server";

const privateHeaders = { "cache-control": "no-store" };

/** Require an explicit Origin matching the browser-facing request origin for cookie-authenticated mutations. */
export function rejectCrossOriginMutation(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return csrfFailure();
  }
  if (!origin || origin === "null") return csrfFailure();
  try {
    if (new URL(origin).origin === requestOrigin && new URL(origin).origin === origin.replace(/\/$/, "")) return undefined;
  } catch {
    // An invalid Origin is rejected below.
  }
  return csrfFailure();
}

function csrfFailure() {
  return NextResponse.json(
    { error: { code: "CSRF_REJECTED", message: "La requête ne provient pas de cette application." } },
    { status: 403, headers: privateHeaders },
  );
}
