import type { User, UserRole, UserStatus } from "./types";

export const AUTH_SESSION_COOKIE = "starter_auth_session";
export const CAPTCHA_TRUST_COOKIE = "starter_captcha_trusted";

export interface AuthSession {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  expiresAt: string;
}

function isUserRole(value: unknown): value is UserRole {
  return value === "user" || value === "admin";
}

function isUserStatus(value: unknown): value is UserStatus {
  return value === "pending_verification" || value === "active" || value === "suspended";
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AuthSession>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    isUserRole(candidate.role) &&
    isUserStatus(candidate.status) &&
    typeof candidate.emailVerified === "boolean" &&
    typeof candidate.expiresAt === "string"
  );
}

function isExpired(expiresAt: string): boolean {
  const expiresAtDate = new Date(expiresAt);
  return Number.isNaN(expiresAtDate.getTime()) || expiresAtDate.getTime() <= Date.now();
}

function toBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }

  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signValue(value: string, secret: string): Promise<string> {
  const cryptoApi = globalThis.crypto?.subtle;

  if (!cryptoApi) {
    throw new Error("Web Crypto API is not available");
  }

  const key = await cryptoApi.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoApi.sign("HMAC", key, new TextEncoder().encode(value));

  return toBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const maxLength = Math.max(left.length, right.length);
  let result = 0;
  result |= left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    result |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return result === 0;
}

export function sessionFromUser(user: User): Omit<AuthSession, "expiresAt"> {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
  };
}

export async function parseAuthSessionCookie(
  value: string | undefined,
  secret: string,
): Promise<AuthSession | null> {
  if (!value) {
    return null;
  }

  const segments = value.split(".");

  if (segments.length !== 2) {
    return null;
  }

  const [payload, signature] = segments;

  try {
    const expectedSignature = await signValue(payload, secret);

    if (!timingSafeEqual(fromBase64Url(signature), fromBase64Url(expectedSignature))) {
      return null;
    }

    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));

    if (isAuthSession(parsed) && !isExpired(parsed.expiresAt)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export async function serializeAuthSession(session: AuthSession, secret: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await signValue(payload, secret);

  return `${payload}.${signature}`;
}

export function getDefaultPostLoginPath(role: UserRole): string {
  return role === "admin" ? "/admin/dashboard" : "/dashboard";
}

export function getPostLoginRedirectPath(
  session: Pick<AuthSession, "role" | "status" | "emailVerified">,
): string {
  if (session.status !== "active" || !session.emailVerified) {
    return "/verify-email";
  }

  return getDefaultPostLoginPath(session.role);
}

export function getProtectedSessionRedirectPath(
  session: Pick<AuthSession, "role" | "status" | "emailVerified">,
  requiredRole?: UserRole,
): string | null {
  if (session.status === "suspended") {
    return "/login";
  }

  if (session.status !== "active" || !session.emailVerified) {
    return "/verify-email";
  }

  if (requiredRole && session.role !== requiredRole) {
    return getDefaultPostLoginPath(session.role);
  }

  return null;
}
