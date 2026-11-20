import { ApiRequestError, apiRequest } from "./client";
import type { ApiRequestOptions } from "./types";
import type {
  AuthError,
  AuthMeResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
  ResendVerificationResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
  User,
  VerifyEmailResponse,
} from "@/lib/auth/types";
import { toAuthErrorCode } from "@/lib/auth/errors";

const USE_MOCK =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_AUTH_MOCK_MODE === "true";

function createMockUser(email: string, role: "user" | "admin", verified: boolean): User {
  return {
    id: `starter-${role}-${email}`,
    email,
    role,
    status: verified ? "active" : "pending_verification",
    emailVerified: verified,
  };
}

function toAuthError(error: unknown): AuthError {
  if (error instanceof Error) {
    const maybeCode = (error as Error & { code?: string }).code;
    return {
      code: toAuthErrorCode(maybeCode),
      message: error.message,
    };
  }

  return { code: "AUTH_UNKNOWN" };
}

async function hasTrustedCaptchaSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/session/trust", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { trusted?: boolean };
    return data.trusted === true;
  } catch {
    return false;
  }
}

async function maybeThrowTurnstileWidgetValidation(turnstileToken: string) {
  const trusted = await hasTrustedCaptchaSession();

  if (trusted) {
    return;
  }

  if (!turnstileToken || turnstileToken.startsWith("fail")) {
    const error = new Error(
      "Cloudflare Turnstile widget check failed",
    ) as Error & { code: string };
    error.code = "AUTH_BOT_PROTECTION_FAILED";
    throw error;
  }
}

async function authRequest<T>(
  path: string,
  init: ApiRequestOptions,
  mockFactory: () => T | Promise<T>,
): Promise<T> {
  try {
    return await apiRequest<T>(path, init);
  } catch (error) {
    if (USE_MOCK && (error instanceof ApiRequestError ? error.status === 404 : true)) {
      return await mockFactory();
    }

    throw toAuthError(error);
  }
}

export async function register(payload: RegisterRequest): Promise<RegisterResponse> {
  return authRequest(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    async () => {
      await maybeThrowTurnstileWidgetValidation(payload.turnstileToken);
      if (payload.email.includes("exists")) {
        const error = new Error("Email already exists") as Error & { code: string };
        error.code = "AUTH_EMAIL_ALREADY_EXISTS";
        throw error;
      }

      if (payload.password.length < 8) {
        const error = new Error("Weak password") as Error & { code: string };
        error.code = "AUTH_WEAK_PASSWORD";
        throw error;
      }

      return {
        user: createMockUser(payload.email, "user", false),
        verificationRequired: true,
      };
    },
  );
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  return authRequest(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    async () => {
      await maybeThrowTurnstileWidgetValidation(payload.turnstileToken);

      if (payload.email.includes("suspended")) {
        const error = new Error("Account suspended") as Error & { code: string };
        error.code = "AUTH_ACCOUNT_SUSPENDED";
        throw error;
      }

      if (payload.email.includes("unverified")) {
        const error = new Error("Email not verified") as Error & { code: string };
        error.code = "AUTH_EMAIL_NOT_VERIFIED";
        throw error;
      }

      if (payload.password.length < 8 || payload.email.includes("invalid")) {
        const error = new Error("Invalid credentials") as Error & { code: string };
        error.code = "AUTH_INVALID_CREDENTIALS";
        throw error;
      }

      const isAdmin = payload.email.startsWith("admin@");
      return {
        user: createMockUser(payload.email, isAdmin ? "admin" : "user", true),
      };
    },
  );
}

export async function logout(): Promise<LogoutResponse> {
  return authRequest(
    "/auth/logout",
    {
      method: "POST",
    },
    () => ({ success: true }),
  );
}

export async function getMe(): Promise<AuthMeResponse> {
  return authRequest(
    "/auth/me",
    {
      method: "GET",
      cache: "no-store",
    },
    () => ({ user: null }),
  );
}

export async function verifyEmail(token: string): Promise<VerifyEmailResponse> {
  return authRequest(
    "/auth/verify-email",
    {
      method: "GET",
      params: { token },
    },
    () => {
      if (!token || token === "invalid") {
        const error = new Error("Invalid verify token") as Error & { code: string };
        error.code = "AUTH_INVALID_VERIFY_TOKEN";
        throw error;
      }

      if (token === "expired") {
        const error = new Error("Verify token expired") as Error & { code: string };
        error.code = "AUTH_VERIFY_TOKEN_EXPIRED";
        throw error;
      }

      return { success: true };
    },
  );
}

export async function resendVerification(payload: ResendVerificationRequest): Promise<ResendVerificationResponse> {
  return authRequest(
    "/auth/resend-verification",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    async () => {
      await maybeThrowTurnstileWidgetValidation(payload.turnstileToken);
      return { success: true };
    },
  );
}

export async function forgotPassword(payload: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
  return authRequest(
    "/auth/forgot-password",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    async () => {
      await maybeThrowTurnstileWidgetValidation(payload.turnstileToken);
      return { success: true };
    },
  );
}

export async function resetPassword(payload: ResetPasswordRequest): Promise<ResetPasswordResponse> {
  return authRequest(
    "/auth/reset-password",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    async () => {
      await maybeThrowTurnstileWidgetValidation(payload.turnstileToken);
      if (!payload.token || payload.token === "invalid") {
        const error = new Error("Invalid verify token") as Error & { code: string };
        error.code = "AUTH_INVALID_VERIFY_TOKEN";
        throw error;
      }

      if (payload.token === "expired") {
        const error = new Error("Verify token expired") as Error & { code: string };
        error.code = "AUTH_VERIFY_TOKEN_EXPIRED";
        throw error;
      }

      if (payload.newPassword.length < 8) {
        const error = new Error("Weak password") as Error & { code: string };
        error.code = "AUTH_WEAK_PASSWORD";
        throw error;
      }

      return { success: true };
    },
  );
}

export function normalizeAuthError(error: unknown): AuthError {
  if (error && typeof error === "object" && "code" in error) {
    const withCode = error as { code?: string; message?: string; status?: number };
    return {
      code: toAuthErrorCode(withCode.code),
      message: withCode.message,
      status: withCode.status,
    };
  }

  return toAuthError(error);
}
