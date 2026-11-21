import { NextResponse, type NextRequest } from "next/server";

/**
 * Authentication and authorization are enforced by backend-validated sessions
 * in server components and API routes. Never trust legacy frontend-signed
 * cookies here: they can outlive a revoked backend session and cause redirects.
 */
export function proxy(_request: NextRequest) {
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
