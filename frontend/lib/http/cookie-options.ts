import type { NextRequest } from "next/server";

export function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim() === "https";
  }

  return request.nextUrl.protocol === "https:";
}

export function getSessionCookieOptions(request: NextRequest, maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: isSecureRequest(request),
    ...(maxAge === 0 ? { expires: new Date(0) } : {}),
    ...(typeof maxAge === "number" ? { maxAge } : {}),
  };
}
