import type { NextRequest } from "next/server";

export function sanitizeRedirectPath(
  targetPath: string | null | undefined,
  fallbackPath = "/login",
): string {
  return targetPath && targetPath.startsWith("/") && !targetPath.startsWith("//")
    ? targetPath
    : fallbackPath;
}

export function buildProxySafeRedirectUrl(
  request: NextRequest,
  targetPath: string,
  fallbackPath = "/login",
): string {
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  const forwardedHost =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.host;

  const safePath = sanitizeRedirectPath(targetPath, fallbackPath);

  return `${forwardedProto}://${forwardedHost}${safePath}`;
}
