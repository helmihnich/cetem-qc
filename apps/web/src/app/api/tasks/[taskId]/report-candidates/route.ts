import { NextResponse } from "next/server";
import { rejectCrossOriginMutation } from "@/app/api/csrf";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";
const privateHeaders = { "cache-control": "no-store" };

const sessionToken = (request: Request) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const unauthenticated = () => NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401, headers: privateHeaders });
const unavailable = () => NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503, headers: privateHeaders });

/** Story 11.1: lists the Word report candidates of a task for a Responsable. A GET needs no CSRF check; only the session cookie is forwarded. */
export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const token = sessionToken(request);
  if (!token) return unauthenticated();
  try {
    const { taskId } = await context.params;
    const response = await fetch(`${apiRoot}/tasks/${encodeURIComponent(taskId)}/report-candidates`, { headers: { authorization: `Bearer ${decodeURIComponent(token)}`, accept: "application/json" }, cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status, headers: privateHeaders });
  } catch {
    return unavailable();
  }
}

/** Story 11.1: forwards a Responsable's request to generate a Word report candidate to the API. */
export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const csrfRejection = rejectCrossOriginMutation(request);
  if (csrfRejection) return csrfRejection;
  const token = sessionToken(request);
  if (!token) return unauthenticated();
  try {
    const { taskId } = await context.params;
    const response = await fetch(`${apiRoot}/tasks/${encodeURIComponent(taskId)}/report-candidates`, { method: "POST", headers: { authorization: `Bearer ${decodeURIComponent(token)}`, "content-type": "application/json", accept: "application/json" }, body: await request.text(), cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status, headers: privateHeaders });
  } catch {
    return unavailable();
  }
}
