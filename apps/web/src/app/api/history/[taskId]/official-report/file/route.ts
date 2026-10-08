import { NextResponse } from "next/server";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";
const privateHeaders = { "cache-control": "no-store" };
const fileMediaTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"];

/**
 * Story 11.5: streams the official report file of a completed control. A GET needs no CSRF check; only the session
 * cookie is forwarded. The bytes and their headers pass through unchanged; an error body is passed through as JSON.
 */
export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401, headers: privateHeaders });
  try {
    const { taskId } = await context.params;
    const response = await fetch(`${apiRoot}/history/${encodeURIComponent(taskId)}/official-report/file`, { headers: { authorization: `Bearer ${decodeURIComponent(token)}` }, cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 200 || !fileMediaTypes.some((type) => contentType.startsWith(type))) {
      return NextResponse.json(await response.json(), { status: response.status, headers: privateHeaders });
    }
    const bytes = await response.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": response.headers.get("content-disposition") ?? "attachment",
        "content-length": String(bytes.byteLength),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503, headers: privateHeaders });
  }
}
