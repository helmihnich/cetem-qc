import { NextResponse } from "next/server";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";
const privateHeaders = { "cache-control": "no-store" };

/**
 * Story 11.2: streams a ready PDF to the owning Responsable for inspection. A GET needs no CSRF check; only the session
 * cookie is forwarded, as a bearer token. Nothing is cached and the type is never sniffed.
 */
export async function GET(request: Request, context: { params: Promise<{ taskId: string; fileId: string }> }) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401, headers: privateHeaders });
  try {
    const { taskId, fileId } = await context.params;
    const response = await fetch(`${apiRoot}/tasks/${encodeURIComponent(taskId)}/pdf-files/${encodeURIComponent(fileId)}/content`, { headers: { authorization: `Bearer ${decodeURIComponent(token)}` }, cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 200 || !contentType.startsWith("application/pdf")) {
      return NextResponse.json(await response.json(), { status: response.status, headers: privateHeaders });
    }
    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": response.headers.get("content-disposition") ?? "attachment",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503, headers: privateHeaders });
  }
}
