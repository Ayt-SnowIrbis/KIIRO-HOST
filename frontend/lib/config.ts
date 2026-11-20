const DEFAULT_SESSION_TTL_HOURS = 24;
const DEV_AUTH_SESSION_SECRET = "dev-only-starter-auth-session-secret";
const DEV_API_BASE_URL = "http://localhost:8080/api";
const DEV_PUBLIC_APP_URL = "http://localhost:3000";

function toPositiveFiniteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const appConfig = {
  sessionTtlHours: toPositiveFiniteNumber(
    process.env.SESSION_TTL_HOURS,
    DEFAULT_SESSION_TTL_HOURS,
  ),
  authMockMode: isAuthMockModeEnabled(
    process.env.NODE_ENV,
    process.env.NEXT_PUBLIC_AUTH_MOCK_MODE,
  ),
};

function getConfiguredUrl(
  value: string | undefined,
  errorMessage: string,
): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  const url = new URL(normalizedValue);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(errorMessage);
  }

  return normalizedValue.replace(/\/$/, "");
}

export function isAuthMockModeEnabled(
  nodeEnv: string | undefined,
  mockModeFlag: string | undefined,
): boolean {
  return nodeEnv !== "production" && mockModeFlag === "true";
}

export function getAuthSessionSecret(): string {
  const configuredSecret = process.env.AUTH_SESSION_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_AUTH_SESSION_SECRET;
  }

  throw new Error("AUTH_SESSION_SECRET is required in production");
}

export function getApiBaseUrl(): string {
  const configuredUrl = getConfiguredUrl(
    process.env.API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim(),
    "API_BASE_URL or NEXT_PUBLIC_API_BASE_URL must be a valid http(s) URL",
  );

  if (configuredUrl) {
    return configuredUrl;
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_API_BASE_URL;
  }

  throw new Error("API_BASE_URL or NEXT_PUBLIC_API_BASE_URL is required in production");
}

export function getPublicAppUrl(): string {
  const configuredUrl = getConfiguredUrl(
    process.env.NEXT_PUBLIC_APP_URL?.trim(),
    "NEXT_PUBLIC_APP_URL must be a valid http(s) URL",
  );

  if (configuredUrl) {
    return configuredUrl;
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_PUBLIC_APP_URL;
  }

  throw new Error("NEXT_PUBLIC_APP_URL is required in production");
}
