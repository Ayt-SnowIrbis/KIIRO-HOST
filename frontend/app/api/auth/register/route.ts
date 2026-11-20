import { NextResponse } from "next/server";
import { registerUser } from "@/lib/api/server-auth";
import { validateRegistrationRoutePayload } from "@/lib/auth/flow";
import { getPublicAppUrl } from "@/lib/config";
import { hasTrustedCaptchaSession } from "@/lib/auth/server-session";
import { getRequestI18n } from "@/lib/i18n/server";
import type { AuthError } from "@/lib/auth/types";

function createGenericRegistrationResponse() {
  return NextResponse.json(
    {
      ok: true,
      verificationRequired: true,
    },
    { status: 202 },
  );
}

export async function POST(request: Request) {
  const payloadResult = validateRegistrationRoutePayload(await request.json().catch(() => null));

  if (!payloadResult.ok) {
    return NextResponse.json(
      {
        message: payloadResult.error.message ?? "Registration failed",
        code: payloadResult.error.code,
      },
      { status: payloadResult.error.status ?? 400 },
    );
  }

  try {
    const { locale } = await getRequestI18n();

    await registerUser(
      {
        ...payloadResult.payload,
        locale,
        publicAppUrl: getPublicAppUrl(),
      },
      await hasTrustedCaptchaSession(),
    );

    return createGenericRegistrationResponse();
  } catch (error) {
    const authError = error as AuthError;

    if (authError.code === "AUTH_EMAIL_ALREADY_EXISTS" || authError.status === 409) {
      return createGenericRegistrationResponse();
    }

    return NextResponse.json(
      {
        message: authError.message ?? "Registration failed",
        code: authError.code ?? "AUTH_UNKNOWN",
      },
      { status: authError.status ?? 500 },
    );
  }
}
