import { NextResponse, type NextRequest } from "next/server";
import { clearServerSession } from "@/lib/auth/server-session";
import { getApiBaseUrl } from "@/lib/config";
import { buildProxySafeRedirectUrl } from "@/lib/http/redirect-url";

const FALLBACK_TARGET = "/login";

async function logout(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next") || FALLBACK_TARGET;
  const token = request.cookies.get("kiiro_session")?.value;
  if (token) {
    try {
      await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/auth/logout`, {
        method: "POST",
        headers: { Cookie: `kiiro_session=${token}` },
        cache: "no-store",
      });
    } catch {
      // The browser cookie is cleared even if the backend is unavailable.
    }
  }
  await clearServerSession();
  const response = NextResponse.redirect(buildProxySafeRedirectUrl(request, next, FALLBACK_TARGET));
  response.cookies.delete("kiiro_session");
  return response;
}

export async function POST(request: NextRequest) {
  return logout(request);
}
