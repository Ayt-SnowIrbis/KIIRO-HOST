import { bgDictionary } from "./dictionaries/bg";
import { enDictionary } from "./dictionaries/en";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Dictionary, type Locale } from "./types";

const dictionaries: Record<Locale, Dictionary> = {
  en: enDictionary,
  bg: bgDictionary,
};

export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "bg";
}

export function normalizeLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function getSupportedLocales(): readonly Locale[] {
  return SUPPORTED_LOCALES;
}

export function getDictionary(locale: string | undefined): Dictionary {
  return dictionaries[normalizeLocale(locale)] ?? dictionaries[DEFAULT_LOCALE];
}
