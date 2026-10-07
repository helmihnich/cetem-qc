import { NextResponse } from "next/server";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";
const privateHeaders = { "cache-control": "no-store" };

/**
 * Story 9.1: forwards a Responsable's read of an accepted task's evidence to the API. A GET needs no CSRF check;
 * only the session cookie is forwarded, as a bearer token, and nothing is cached.
 */
export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401, headers: privateHeaders });
  try {
    const { taskId } = await context.params;
    const response = await fetch(`${apiRoot}/tasks/${encodeURIComponent(taskId)}/accepted-evidence`, { headers: { authorization: `Bearer ${decodeURIComponent(token)}`, accept: "application/json" }, cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status, headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503, headers: privateHeaders });
  }
}
