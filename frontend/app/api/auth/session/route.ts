import { NextResponse, type NextRequest } from "next/server";
import { authenticateUser } from "@/lib/api/server-auth";
import { getPostLoginRedirectPath } from "@/lib/auth/session";
import {
  clearServerSession,
  createServerSession,
  hasTrustedCaptchaSession,
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
    const response = await authenticateUser(
      {
        email: payload.email,
        password: payload.password,
        turnstileToken: payload.turnstileToken ?? "",
        ...(payload.totpCode ? { totpCode: payload.totpCode } : {}),
      },
      await hasTrustedCaptchaSession(),
    );
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

    await createServerSession(response.user);

    return NextResponse.json({
      ok: true,
      redirectTo,
    });
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
