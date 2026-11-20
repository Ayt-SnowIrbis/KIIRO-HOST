import { cookies } from "next/headers";
import { getDictionary, normalizeLocale } from "./index";
import { LOCALE_COOKIE, type Locale } from "./types";

export async function getRequestI18n(): Promise<{ locale: Locale; dictionary: ReturnType<typeof getDictionary> }> {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  return {
    locale,
    dictionary: getDictionary(locale),
  };
}
