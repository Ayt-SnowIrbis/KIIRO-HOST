import { NextResponse, type NextRequest } from "next/server";
import { getApiBaseUrl } from "@/lib/config";
import { getPostLoginRedirectPath } from "@/lib/auth/session";
import {
  clearServerSession,
} from "@/lib/auth/server-session";
import { sanitizeRedirectPath } from "@/lib/http/redirect-url";
import type { AuthError, LoginRequest } from "@/lib/auth/types";

interface CreateSessionPayload extends Partial<LoginRequest> {
  next?: string;
}

function isValidLoginPayload(
  payload: CreateSessionPayload,
): payload is { email: string; password: string; turnstileToken?: string; totpCode?: string; next?: string } {
  return (
    typeof payload.email === "string" &&
    typeof payload.password === "string" &&
    (payload.turnstileToken === undefined || typeof payload.turnstileToken === "string") &&
    (payload.totpCode === undefined || (typeof payload.totpCode === "string" && /^\d{6}$/.test(payload.totpCode))) &&
    (payload.next === undefined || typeof payload.next === "string")
  );
}

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as CreateSessionPayload;

  if (!isValidLoginPayload(payload)) {
    return NextResponse.json(
      { message: "valid login payload is required" },
      { status: 400 },
    );
  }

  try {
    const backend = await fetch(`${getApiBaseUrl().replace(/\\/$/, "")}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
        turnstileToken: payload.turnstileToken ?? "",
        ...(payload.totpCode ? { totpCode: payload.totpCode } : {}),
      }),
      cache: "no-store",
    });
    const response = (await backend.json()) as { user: import("@/lib/auth/types").User; code?: string; message?: string };
    if (!backend.ok) {
      return NextResponse.json({ message: response.message ?? "Authentication failed", code: response.code ?? "AUTH_UNKNOWN" }, { status: backend.status });
    }
    if (!response.user || !["user", "admin"].includes(response.user.role)) {
      return NextResponse.json({ message: "Invalid backend login response" }, { status: 502 });
    }
    const setCookie = backend.headers.get("set-cookie") ?? "";
    const match = /(?:^|;)\\s*kiiro_session=([A-Za-z0-9_-]{32,256})(?:;|$)/.exec(setCookie);
    if (!match) return NextResponse.json({ message: "Backend session missing" }, { status: 502 });
    const safeDefaultRedirect = getPostLoginRedirectPath(response.user);
    const redirectTo =
      safeDefaultRedirect === "/verify-email"
        ? safeDefaultRedirect
        : sanitizeRedirectPath(payload.next, safeDefaultRedirect);

    if (response.user.status === "suspended") {
      await clearServerSession();
      return NextResponse.json(
        {
          message: "Account suspended",
          code: "AUTH_ACCOUNT_SUSPENDED",
        },
        { status: 403 },
      );
    }

    const result = NextResponse.json({ ok: true, redirectTo });
    result.cookies.set("kiiro_session", match[1], {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });
    return result;
  } catch (error) {
    const authError = error as AuthError;

    return NextResponse.json(
      {
        message: authError.message ?? "Authentication failed",
        code: authError.code ?? "AUTH_UNKNOWN",
      },
      { status: authError.status ?? 500 },
    );
  }
}

export async function DELETE() {
  await clearServerSession();
  return NextResponse.json({ ok: true });
}
