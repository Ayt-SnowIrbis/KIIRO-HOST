import { sanitizeRedirectPath } from "../http/redirect-url";
import { getDefaultPostLoginPath } from "./session";
import type { AuthError, User } from "./types";

const FORBIDDEN_REGISTRATION_FIELDS = ["id", "role", "status", "emailVerified", "user"] as const;

function createInvalidPayloadError(message: string): AuthError {
  return {
    code: "AUTH_UNKNOWN",
    status: 400,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasForbiddenRegistrationFields(payload: Record<string, unknown>): boolean {
  return FORBIDDEN_REGISTRATION_FIELDS.some((field) => field in payload);
}

export interface RegistrationRoutePayload {
  email: string;
  password: string;
  displayName?: string;
  turnstileToken: string;
}

export interface VerificationRoutePayload {
  token: string;
  next?: string;
}

export function validateRegistrationRoutePayload(
  input: unknown,
): { ok: true; payload: RegistrationRoutePayload } | { ok: false; error: AuthError } {
  if (!isRecord(input) || hasForbiddenRegistrationFields(input)) {
    return {
      ok: false,
      error: createInvalidPayloadError("valid registration payload is required"),
    };
  }

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const turnstileToken =
    typeof input.turnstileToken === "string" ? input.turnstileToken.trim() : "";
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : undefined;

  if (!email || !password || !turnstileToken) {
    return {
      ok: false,
      error: createInvalidPayloadError("email, password, and turnstileToken are required"),
    };
  }

  return {
    ok: true,
    payload: {
      email,
      password,
      turnstileToken,
      ...(displayName ? { displayName } : {}),
    },
  };
}

export function validateVerificationRoutePayload(
  input: unknown,
): { ok: true; payload: VerificationRoutePayload } | { ok: false; error: AuthError } {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: createInvalidPayloadError("valid verification payload is required"),
    };
  }

  const token = typeof input.token === "string" ? input.token.trim() : "";
  const next = typeof input.next === "string" ? input.next : undefined;

  if (!token) {
    return {
      ok: false,
      error: createInvalidPayloadError("token is required"),
    };
  }

  return {
    ok: true,
    payload: { token, ...(next ? { next } : {}) },
  };
}

export function normalizeRegistrationAck(response: unknown): { verificationRequired: true } | null {
  if (!isRecord(response)) {
    return null;
  }

  if ("user" in response) {
    const user = response.user as Partial<User> | undefined;

    if (
      !user ||
      typeof user.id !== "string" ||
      typeof user.email !== "string" ||
      (user.role !== "user" && user.role !== "admin") ||
      (user.status !== "pending_verification" &&
        user.status !== "active" &&
        user.status !== "suspended") ||
      typeof user.emailVerified !== "boolean"
    ) {
      return null;
    }

    if (user.status !== "active" || !user.emailVerified) {
      return { verificationRequired: true };
    }

    return null;
  }

  if (response.verificationRequired === true || response.success === true) {
    return { verificationRequired: true };
  }

  return null;
}

export function normalizeVerificationAck(
  response: unknown,
): { success: true; user?: User } | null {
  if (!isRecord(response)) {
    return null;
  }

  if (!("user" in response) || response.user === undefined || response.user === null) {
    if (response.success !== true) {
      return null;
    }

    return { success: true };
  }

  const user = response.user as Partial<User>;

  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    (user.role !== "user" && user.role !== "admin") ||
    (user.status !== "pending_verification" &&
      user.status !== "active" &&
      user.status !== "suspended") ||
    typeof user.emailVerified !== "boolean"
  ) {
    return null;
  }

  return { success: true, user: user as User };
}

export function buildEmailVerificationUrlTemplate(publicAppUrl: string): string {
  const baseUrl = new URL(publicAppUrl);
  const basePath = baseUrl.pathname.replace(/\/$/, "");
  baseUrl.pathname = `${basePath}/verify-email`.replace(/\/{2,}/g, "/");
  baseUrl.search = "";
  baseUrl.searchParams.set("token", "{token}");
  return baseUrl.toString();
}

export function resolvePostVerificationRedirect(
  user: Pick<User, "role" | "status" | "emailVerified"> | undefined,
  next?: string,
): string {
  if (!user) {
    return "/login?verified=1";
  }

  return user.status === "active" && user.emailVerified
    ? sanitizeRedirectPath(next, getDefaultPostLoginPath(user.role))
    : "/login?verified=1";
}
