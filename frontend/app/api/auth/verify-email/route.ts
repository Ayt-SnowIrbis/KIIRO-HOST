import { NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/api/server-auth";
import { resolvePostVerificationRedirect, validateVerificationRoutePayload } from "@/lib/auth/flow";
import { clearServerSession, createServerSession } from "@/lib/auth/server-session";
import type { AuthError } from "@/lib/auth/types";

export async function POST(request: Request) {
  const payloadResult = validateVerificationRoutePayload(await request.json().catch(() => null));

  if (!payloadResult.ok) {
    return NextResponse.json(
      {
        message: payloadResult.error.message ?? "Verification failed",
        code: payloadResult.error.code,
      },
      { status: payloadResult.error.status ?? 400 },
    );
  }

  try {
    const response = await verifyEmailToken(payloadResult.payload.token);

    if (response.user) {
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

      if (response.user.status !== "active" || !response.user.emailVerified) {
        await clearServerSession();
        return NextResponse.json(
          {
            message: "Verification incomplete",
            code: "AUTH_EMAIL_NOT_VERIFIED",
          },
          { status: 409 },
        );
      }

      await createServerSession(response.user);
    } else {
      await clearServerSession();
    }

    return NextResponse.json({
      ok: true,
      redirectTo: resolvePostVerificationRedirect(response.user, payloadResult.payload.next),
    });
  } catch (error) {
    const authError = error as AuthError;

    return NextResponse.json(
      {
        message: authError.message ?? "Verification failed",
        code: authError.code ?? "AUTH_UNKNOWN",
      },
      { status: authError.status ?? 500 },
    );
  }
}
