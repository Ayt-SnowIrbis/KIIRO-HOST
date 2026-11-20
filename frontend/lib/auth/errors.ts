import type { AuthError, AuthErrorCode } from "./types";
import type { Dictionary } from "@/lib/i18n/types";

const authErrorTranslationMap: Record<AuthErrorCode, keyof Dictionary["errors"]["auth"]> = {
  AUTH_INVALID_CREDENTIALS: "invalidCredentials",
  AUTH_EMAIL_NOT_VERIFIED: "emailNotVerified",
  AUTH_ACCOUNT_SUSPENDED: "accountSuspended",
  AUTH_EMAIL_ALREADY_EXISTS: "emailAlreadyExists",
  AUTH_WEAK_PASSWORD: "weakPassword",
  AUTH_BOT_PROTECTION_FAILED: "botProtectionFailed",
  AUTH_INVALID_VERIFY_TOKEN: "invalidVerifyToken",
  AUTH_VERIFY_TOKEN_EXPIRED: "verifyTokenExpired",
  AUTH_UNKNOWN: "unknown",
};

export function toAuthErrorCode(value: string | undefined): AuthErrorCode {
  if (!value) {
    return "AUTH_UNKNOWN";
  }

  return value in authErrorTranslationMap
    ? (value as AuthErrorCode)
    : "AUTH_UNKNOWN";
}

export function resolveAuthErrorMessage(
  error: AuthError | null,
  errors: Dictionary["errors"],
): string {
  if (!error) {
    return errors.auth.unknown;
  }

  const key = authErrorTranslationMap[error.code] ?? "unknown";
  return errors.auth[key];
}
