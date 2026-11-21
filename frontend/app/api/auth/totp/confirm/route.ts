import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/config";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("kiiro_session")?.value;
  if (!token) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  const payload = await request.json();
  if (typeof payload.code !== "string" || !/^\d{6}$/.test(payload.code)) {
    return NextResponse.json({ message: "Six-digit code required" }, { status: 400 });
  }
  try {
    const backend = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/auth/totp/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `kiiro_session=${token}` },
      body: JSON.stringify({ code: payload.code }),
      cache: "no-store",
    });
    return NextResponse.json(await backend.json(), { status: backend.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Backend unavailable" }, { status: 503 });
  }
}
