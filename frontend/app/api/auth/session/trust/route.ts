import { NextResponse } from "next/server";
import { getAuthSession, hasTrustedCaptchaSession } from "@/lib/auth/server-session";

export async function GET() {
  const session = await getAuthSession();
  const trusted = await hasTrustedCaptchaSession();

  return NextResponse.json({
    authenticated: Boolean(session),
    trusted,
  });
}
