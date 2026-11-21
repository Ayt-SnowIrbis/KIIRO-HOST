import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/config";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("kiiro_session")?.value;
  if (!token) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  const payload = await request.json();
  if (typeof payload.password !== "string" || !payload.password) {
    return NextResponse.json({ message: "Password required" }, { status: 400 });
  }
  try {
    const backend = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/auth/totp/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `kiiro_session=${token}` },
      body: JSON.stringify({ password: payload.password }),
      cache: "no-store",
    });
    return NextResponse.json(await backend.json(), { status: backend.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Backend unavailable" }, { status: 503 });
  }
}
