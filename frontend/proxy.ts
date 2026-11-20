import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_SESSION_COOKIE,
  CAPTCHA_TRUST_COOKIE,
  getPostLoginRedirectPath,
  parseAuthSessionCookie,
} from "@/lib/auth/session";
import { getAuthSessionSecret } from "@/lib/config";
import { buildProxySafeRedirectUrl } from "@/lib/http/redirect-url";
import { getSessionCookieOptions } from "@/lib/http/cookie-options";

const GUEST_ONLY_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/resend-verification",
];

export async function proxy(request: NextRequest) {
  const session = await parseAuthSessionCookie(
    request.cookies.get(AUTH_SESSION_COOKIE)?.value,
    getAuthSessionSecret(),
  );
  const { pathname } = request.nextUrl;

  if (session?.status === "suspended") {
    const response = NextResponse.redirect(
      buildProxySafeRedirectUrl(request, "/login", "/login"),
    );

    response.cookies.set(AUTH_SESSION_COOKIE, "", getSessionCookieOptions(request, 0));
    response.cookies.set(CAPTCHA_TRUST_COOKIE, "", getSessionCookieOptions(request, 0));

    return response;
  }

  if (
    GUEST_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    session
  ) {
    return NextResponse.redirect(
      buildProxySafeRedirectUrl(
        request,
        getPostLoginRedirectPath(session),
        "/login",
      ),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/resend-verification",
    "/dashboard/:path*",
    "/admin/:path*",
  ],
};
