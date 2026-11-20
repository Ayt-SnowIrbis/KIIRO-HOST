import "server-only";

import { appConfig } from "@/lib/config";
import { toAuthErrorCode } from "@/lib/auth/errors";
import {
  buildEmailVerificationUrlTemplate,
  normalizeRegistrationAck,
  normalizeVerificationAck,
} from "@/lib/auth/flow";
import type {
  AuthError,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  User,
} from "@/lib/auth/types";
import type { ApiRequestOptions } from "./types";
import { ApiRequestError, apiRequest } from "./client";

interface BackendRegisterRequest extends RegisterRequest {
  locale?: string;
  publicAppUrl: string;
}

interface VerifyEmailAck {
  success: true;
  user?: User;
}

function createMockUserFromCredentials(email: string): User {
  const normalizedEmail = email.trim().toLowerCase();
  const role = normalizedEmail.startsWith("admin@") ? "admin" : "user";
  const isSuspended = normalizedEmail.includes("suspended");
  const isPendingVerification =
    normalizedEmail.includes("unverified") || normalizedEmail.includes("pending");

  return {
    id: `starter-${role}-${normalizedEmail}`,
    email: normalizedEmail,
    role,
    status: isSuspended ? "suspended" : isPendingVerification ? "pending_verification" : "active",
    emailVerified: !isPendingVerification,
  };
}

function createAuthError(code: AuthError["code"], status: number, message: string): AuthError {
  return { code, status, message };
}

function isValidUser(user: unknown): user is User {
  if (!user || typeof user !== "object") {
    return false;
  }

  const candidate = user as Partial<User>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    (candidate.role === "user" || candidate.role === "admin") &&
    (candidate.status === "pending_verification" ||
      candidate.status === "active" ||
      candidate.status === "suspended") &&
    typeof candidate.emailVerified === "boolean"
  );
}

function isValidLoginResponse(response: unknown): response is LoginResponse {
  if (!response || typeof response !== "object") {
    return false;
  }

  return isValidUser((response as Partial<LoginResponse>).user);
}

function normalizeAuthError(error: unknown): AuthError {
  if (error instanceof ApiRequestError) {
    return {
      code: toAuthErrorCode(error.code),
      message: error.message,
      status: error.status,
    };
  }

  if (error && typeof error === "object" && "code" in error) {
    const withCode = error as { code?: string; message?: string; status?: number };
    return {
      code: toAuthErrorCode(withCode.code),
      message: withCode.message,
      status: withCode.status,
    };
  }

  return { code: "AUTH_UNKNOWN", status: 500 };
}

async function createMockLoginResponse(
  payload: LoginRequest,
  captchaTrusted: boolean,
): Promise<LoginResponse> {
  if (!captchaTrusted && (!payload.turnstileToken || payload.turnstileToken.startsWith("fail"))) {
    throw createAuthError(
      "AUTH_BOT_PROTECTION_FAILED",
      400,
      "Cloudflare Turnstile widget check failed",
    );
  }

  if (payload.password.length < 8 || payload.email.includes("invalid")) {
    throw createAuthError("AUTH_INVALID_CREDENTIALS", 401, "Invalid credentials");
  }

  return {
    user: createMockUserFromCredentials(payload.email),
  };
}

async function createMockRegisterResponse(
  payload: BackendRegisterRequest,
  captchaTrusted: boolean,
): Promise<{ verificationRequired: true }> {
  if (!captchaTrusted && (!payload.turnstileToken || payload.turnstileToken.startsWith("fail"))) {
    throw createAuthError(
      "AUTH_BOT_PROTECTION_FAILED",
      400,
      "Cloudflare Turnstile widget check failed",
    );
  }

  if (payload.password.length < 8) {
    throw createAuthError("AUTH_WEAK_PASSWORD", 400, "Weak password");
  }

  if (payload.email.includes("exists")) {
    throw createAuthError("AUTH_EMAIL_ALREADY_EXISTS", 409, "Email already exists");
  }

  return { verificationRequired: true };
}

async function createMockVerifyEmailResponse(token: string): Promise<VerifyEmailAck> {
  if (!token || token === "invalid") {
    throw createAuthError("AUTH_INVALID_VERIFY_TOKEN", 400, "Invalid verify token");
  }

  if (token === "expired") {
    throw createAuthError("AUTH_VERIFY_TOKEN_EXPIRED", 410, "Verify token expired");
  }

  return {
    success: true,
    user: {
      id: "starter-user-verified",
      email: "verified@example.com",
      role: "user",
      status: "active",
      emailVerified: true,
    },
  };
}

async function requestAuthContract<T>(
  path: string,
  init: ApiRequestOptions,
  mockFactory?: () => Promise<T>,
): Promise<T> {
  try {
    return await apiRequest<T>(path, {
      ...init,
      cache: "no-store",
    });
  } catch (error) {
    if (
      mockFactory &&
      appConfig.authMockMode &&
      (error instanceof ApiRequestError ? error.status === 404 : true)
    ) {
      return mockFactory();
    }

    throw normalizeAuthError(error);
  }
}

export async function authenticateUser(
  payload: LoginRequest,
  captchaTrusted: boolean,
): Promise<LoginResponse> {
  const response = await requestAuthContract<LoginResponse>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    () => createMockLoginResponse(payload, captchaTrusted),
  );

  if (!isValidLoginResponse(response)) {
    throw createAuthError("AUTH_UNKNOWN", 502, "Invalid auth response");
  }

  return response;
}

export async function registerUser(
  payload: BackendRegisterRequest,
  captchaTrusted: boolean,
): Promise<{ verificationRequired: true }> {
  const { email, password, displayName, turnstileToken, locale, publicAppUrl } = payload;
  const response = await requestAuthContract<unknown>(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        turnstileToken,
        ...(displayName ? { displayName } : {}),
        ...(locale ? { locale } : {}),
        verificationUrl: buildEmailVerificationUrlTemplate(publicAppUrl),
      }),
    },
    () => createMockRegisterResponse(payload, captchaTrusted),
  );
  const normalized = normalizeRegistrationAck(response);

  if (!normalized) {
    throw createAuthError("AUTH_UNKNOWN", 502, "Invalid registration response");
  }

  return normalized;
}

export async function verifyEmailToken(token: string): Promise<VerifyEmailAck> {
  const response = await requestAuthContract<unknown>(
    "/auth/verify-email",
    {
      method: "GET",
      params: { token },
    },
    () => createMockVerifyEmailResponse(token),
  );
  const normalized = normalizeVerificationAck(response);

  if (!normalized) {
    throw createAuthError("AUTH_UNKNOWN", 502, "Invalid verification response");
  }

  return normalized;
}
