import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@/lib/i18n";
import { DEFAULT_LOCALE, LOCALE_COOKIE } from "@/lib/i18n/types";

export function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("lang") ?? undefined;
  const next = request.nextUrl.searchParams.get("next") || "/";

  const forwardedProto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(":", "");
  const forwardedHost =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.host;

  const safeNext = next.startsWith("/") ? next : "/";

  const response = NextResponse.redirect(
    `${forwardedProto}://${forwardedHost}${safeNext}`,
  );

  response.cookies.set(
    LOCALE_COOKIE,
    isLocale(locale) ? locale : DEFAULT_LOCALE,
    {
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    },
  );

  return response;
}
