import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appConfig, getApiBaseUrl } from "@/lib/config";
import { getAuthSessionSecret } from "@/lib/config";
import {
  AUTH_SESSION_COOKIE,
  CAPTCHA_TRUST_COOKIE,
  getProtectedSessionRedirectPath,
  parseAuthSessionCookie,
  serializeAuthSession,
  sessionFromUser,
  type AuthSession,
} from "./session";
import type { User } from "./types";

function getSessionTtlMs(): number {
  return getSessionMaxAge() * 1000;
}

function getSessionMaxAge(): number {
  return Math.round(appConfig.sessionTtlHours * 60 * 60);
}

function getSessionExpiresAt(): Date {
  return new Date(Date.now() + getSessionTtlMs());
}

function getSessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function createServerSession(user: User): Promise<AuthSession> {
  const expiresAt = getSessionExpiresAt();
  const session: AuthSession = {
    ...sessionFromUser(user),
    expiresAt: expiresAt.toISOString(),
  };
  const cookieStore = await cookies();
  const cookieOptions = getSessionCookieOptions();
  const secret = getAuthSessionSecret();

  cookieStore.set({
    name: AUTH_SESSION_COOKIE,
    value: await serializeAuthSession(session, secret),
    ...cookieOptions,
    expires: expiresAt,
    maxAge: getSessionMaxAge(),
  });

  cookieStore.set({
    name: CAPTCHA_TRUST_COOKIE,
    value: "1",
    ...cookieOptions,
    maxAge: getSessionMaxAge(),
  });

  return session;
}

export async function clearServerSession(): Promise<void> {
  const cookieStore = await cookies();
  const cookieOptions = getSessionCookieOptions();

  cookieStore.set({
    name: AUTH_SESSION_COOKIE,
    value: "",
    ...cookieOptions,
    expires: new Date(0),
    maxAge: 0,
  });

  cookieStore.set({
    name: CAPTCHA_TRUST_COOKIE,
    value: "",
    ...cookieOptions,
    expires: new Date(0),
    maxAge: 0,
  });
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const backendToken = cookieStore.get("kiiro_session")?.value;
  if (!backendToken || !/^[A-Za-z0-9_-]{32,256}$/.test(backendToken)) return null;
  try {
    const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/auth/me`, {
      headers: { Cookie: `kiiro_session=${backendToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { user?: User };
    const user = data.user;
    if (!user || (user.role !== "admin" && user.role !== "user") || user.status !== "active" || !user.emailVerified) return null;
    return { ...sessionFromUser(user), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  } catch {
    return null;
  }
}

export async function hasTrustedCaptchaSession(): Promise<boolean> {
  const cookieStore = await cookies();
  // CAPTCHA must be verified by the backend for each protected action.
  return false;
}

function redirectForMissingOrInvalidSession(): never {
  redirect("/login");
}

async function requireRoleSession(requiredRole?: User["role"]): Promise<AuthSession> {
  const session = await getAuthSession();

  if (!session) {
    redirectForMissingOrInvalidSession();
  }

  const authenticatedSession = session;
  const redirectPath = getProtectedSessionRedirectPath(authenticatedSession, requiredRole);

  if (redirectPath) {
    redirect(redirectPath);
  }

  return authenticatedSession;
}

export async function requireAuthSession(): Promise<AuthSession> {
  return requireRoleSession();
}

export async function requireUserSession(): Promise<AuthSession> {
  return requireRoleSession("user");
}

export async function requireAdminSession(): Promise<AuthSession> {
  return requireRoleSession("admin");
}
