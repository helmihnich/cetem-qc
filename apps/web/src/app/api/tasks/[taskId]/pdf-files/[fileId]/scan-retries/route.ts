import { NextResponse } from "next/server";
import { rejectCrossOriginMutation } from "@/app/api/csrf";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";
const privateHeaders = { "cache-control": "no-store" };

/** Story 11.2: forwards a Responsable's request to re-scan a PDF file whose scan failed or is pending. */
export async function POST(request: Request, context: { params: Promise<{ taskId: string; fileId: string }> }) {
  const csrfRejection = rejectCrossOriginMutation(request);
  if (csrfRejection) return csrfRejection;
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401, headers: privateHeaders });
  try {
    const { taskId, fileId } = await context.params;
    const response = await fetch(`${apiRoot}/tasks/${encodeURIComponent(taskId)}/pdf-files/${encodeURIComponent(fileId)}/scan-retries`, { method: "POST", headers: { authorization: `Bearer ${decodeURIComponent(token)}`, accept: "application/json" }, cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status, headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503, headers: privateHeaders });
  }
}
