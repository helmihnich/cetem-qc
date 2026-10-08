import { NextResponse } from "next/server";
import { rejectCrossOriginMutation } from "@/app/api/csrf";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";
const privateHeaders = { "cache-control": "no-store" };

const sessionToken = (request: Request) => request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const unauthenticated = () => NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401, headers: privateHeaders });
const unavailable = () => NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503, headers: privateHeaders });

/** Story 11.2: lists the uploaded PDF files of a task for a Responsable. A GET needs no CSRF check; only the session cookie is forwarded. */
export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const token = sessionToken(request);
  if (!token) return unauthenticated();
  try {
    const { taskId } = await context.params;
    const response = await fetch(`${apiRoot}/tasks/${encodeURIComponent(taskId)}/pdf-files`, { headers: { authorization: `Bearer ${decodeURIComponent(token)}`, accept: "application/json" }, cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status, headers: privateHeaders });
  } catch {
    return unavailable();
  }
}

/** Story 11.2: forwards a Responsable's raw PDF upload with its media type, attempt ID and file name to the API. */
export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const csrfRejection = rejectCrossOriginMutation(request);
  if (csrfRejection) return csrfRejection;
  const token = sessionToken(request);
  if (!token) return unauthenticated();
  try {
    const { taskId } = await context.params;
    const headers: Record<string, string> = {
      authorization: `Bearer ${decodeURIComponent(token)}`, accept: "application/json",
      "content-type": request.headers.get("content-type") ?? "application/octet-stream",
    };
    const attemptId = request.headers.get("x-attempt-id");
    const fileName = request.headers.get("x-file-name");
    if (attemptId) headers["x-attempt-id"] = attemptId;
    if (fileName) headers["x-file-name"] = fileName;
    const response = await fetch(`${apiRoot}/tasks/${encodeURIComponent(taskId)}/pdf-files`, { method: "POST", headers, body: await request.arrayBuffer(), cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status, headers: privateHeaders });
  } catch {
    return unavailable();
  }
}
