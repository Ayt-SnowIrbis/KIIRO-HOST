import { NextResponse, type NextRequest } from "next/server";
import { clearServerSession } from "@/lib/auth/server-session";
import { buildProxySafeRedirectUrl } from "@/lib/http/redirect-url";

const FALLBACK_TARGET = "/login";

async function logout(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next") || FALLBACK_TARGET;
  await clearServerSession();
  return NextResponse.redirect(
    buildProxySafeRedirectUrl(request, next, FALLBACK_TARGET),
  );
}

export async function POST(request: NextRequest) {
  return logout(request);
}
