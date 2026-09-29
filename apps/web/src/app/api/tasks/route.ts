import { NextResponse } from "next/server";
import { rejectCrossOriginMutation } from "@/app/api/csrf";

const apiRoot = `${process.env.CETEM_QC_API_URL ?? "http://127.0.0.1:3001"}/api/v1`;
const cookieName = "cetem_qc_session";

export async function GET(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401, headers: { "cache-control": "no-store" } });
  try {
    const search = new URL(request.url).search;
    const response = await fetch(`${apiRoot}/tasks${search}`, { headers: { authorization: `Bearer ${decodeURIComponent(token)}`, accept: "application/json" }, cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectCrossOriginMutation(request);
  if (csrfRejection) return csrfRejection;
  const token = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return NextResponse.json({ error: { code: "AUTHENTICATION_FAILED", message: "Session requise." } }, { status: 401, headers: { "cache-control": "no-store" } });
  try {
    const response = await fetch(`${apiRoot}/tasks`, { method: "POST", headers: { authorization: `Bearer ${decodeURIComponent(token)}`, "content-type": "application/json", accept: "application/json" }, body: await request.text(), cache: "no-store" });
    return NextResponse.json(await response.json(), { status: response.status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Le service est momentanément indisponible." } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
