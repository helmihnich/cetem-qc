import { NextResponse } from "next/server";
import { rejectCrossOriginMutation } from "@/app/api/csrf";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";
const maxAgeSeconds = 8 * 60 * 60;

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: maxAgeSeconds };
}

function failure(message = "Une erreur est survenue.", status = 500) {
  return NextResponse.json({ error: { code: "SESSION_REQUEST_FAILED", message } }, { status });
}

export async function GET(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return failure("Session requise.", 401);
  try {
    const response = await fetch(`${apiRoot}/session`, { headers: { authorization: `Bearer ${decodeURIComponent(token)}`, accept: "application/json" }, cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      const rejected = NextResponse.json(payload, { status: response.status });
      rejected.cookies.set(cookieName, "", { ...cookieOptions(), maxAge: 0 });
      return rejected;
    }
    return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
  } catch {
    return failure("Le service est momentanément indisponible.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string" || !body.email || !body.password) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." } }, { status: 400 });
    }
    const response = await fetch(`${apiRoot}/authenticate`, {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
    const payload = await response.json() as { token?: string };
    if (!response.ok) return NextResponse.json({ error: { code: response.status === 401 ? "AUTHENTICATION_FAILED" : "AUTHENTICATION_UNAVAILABLE", message: response.status === 401 ? "Email ou mot de passe invalide." : "Une erreur est survenue." } }, { status: response.status });
    if (!payload.token) return failure();
    const result = NextResponse.json({ authenticated: true });
    result.cookies.set(cookieName, payload.token, cookieOptions());
    return result;
  } catch {
    return failure("Le service est momentanément indisponible.", 503);
  }
}

export async function DELETE(request: Request) {
  const csrfRejection = rejectCrossOriginMutation(request);
  if (csrfRejection) return csrfRejection;
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const result = NextResponse.json({ authenticated: false });
  result.cookies.set(cookieName, "", { ...cookieOptions(), maxAge: 0 });
  if (!token) return result;
  try {
    const response = await fetch(`${apiRoot}/session`, { method: "DELETE", headers: { authorization: `Bearer ${decodeURIComponent(token)}` }, cache: "no-store" });
    if (!response.ok && response.status !== 401) {
      const unavailable = failure("La déconnexion n’a pas pu être confirmée auprès du serveur.", 503);
      unavailable.cookies.set(cookieName, "", { ...cookieOptions(), maxAge: 0 });
      return unavailable;
    }
    return result;
  } catch {
    const unavailable = failure("La déconnexion n’a pas pu être confirmée auprès du serveur.", 503);
    unavailable.cookies.set(cookieName, "", { ...cookieOptions(), maxAge: 0 });
    return unavailable;
  }
}
