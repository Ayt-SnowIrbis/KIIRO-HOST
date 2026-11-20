import { NextResponse, type NextRequest } from "next/server";
import { appConfig } from "@/lib/config";
import { isRole } from "@/lib/auth";
import { getDefaultPostLoginPath } from "@/lib/auth/session";
import { createServerSession } from "@/lib/auth/server-session";
import { buildProxySafeRedirectUrl } from "@/lib/http/redirect-url";
import type { User } from "@/lib/auth/types";

const FALLBACK_TARGET = "/login";

function createMockUser(role: "user" | "admin"): User {
  return {
    id: `starter-${role}`,
    email: role === "admin" ? "admin@example.com" : "user@example.com",
    role,
    status: "active",
    emailVerified: true,
  };
}

export async function GET(request: NextRequest) {
  if (!appConfig.authMockMode) {
    return NextResponse.redirect(
      buildProxySafeRedirectUrl(request, FALLBACK_TARGET, FALLBACK_TARGET),
    );
  }

  const role = request.nextUrl.searchParams.get("role") ?? undefined;
  const nextParam = request.nextUrl.searchParams.get("next");

  if (!isRole(role)) {
    return NextResponse.redirect(
      buildProxySafeRedirectUrl(request, FALLBACK_TARGET, FALLBACK_TARGET),
    );
  }

  const next = nextParam || getDefaultPostLoginPath(role);
  await createServerSession(createMockUser(role));

  return NextResponse.redirect(
    buildProxySafeRedirectUrl(request, next, FALLBACK_TARGET),
  );
}
