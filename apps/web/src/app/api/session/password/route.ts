import { NextResponse } from "next/server";
import { rejectCrossOriginMutation } from "@/app/api/csrf";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";

export async function POST(request: Request) {
  const csrfRejection = rejectCrossOriginMutation(request);
  if (csrfRejection) return csrfRejection;
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401 });
  try {
    const body = await request.json();
    const response = await fetch(`${apiRoot}/authenticate/password`, {
      method: "POST", headers: { authorization: `Bearer ${decodeURIComponent(token)}`, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
    const payload = await response.json() as { token?: string; user?: unknown; sessionExpiresAt?: string };
    if (!response.ok) return NextResponse.json(payload, { status: response.status });
    if (!payload.token || !payload.user) return NextResponse.json({ error: { code: "UNEXPECTED_API_RESPONSE", message: "Une erreur est survenue." } }, { status: 502 });
    const result = NextResponse.json({ user: payload.user, sessionExpiresAt: payload.sessionExpiresAt });
    result.cookies.set(cookieName, payload.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 8 * 60 * 60 });
    return result;
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503 });
  }
}
