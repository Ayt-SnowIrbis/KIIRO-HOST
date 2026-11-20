"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { getSupportedLocales } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/types";

interface LanguageSwitcherProps {
  currentLocale: Locale;
  label: string;
}

export function LanguageSwitcher({
  currentLocale,
  label,
}: LanguageSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const query = searchParams.toString();
  const nextPath = query ? `${pathname}?${query}` : pathname;

  const handleSwitch = async (locale: Locale) => {
    const response = await fetch(
      `/api/locale?lang=${locale}&next=${encodeURIComponent(nextPath)}`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2 text-xs text-slate-600">
      <span>{label}:</span>
      {getSupportedLocales().map((locale) => {
        const isActive = locale === currentLocale;

        return (
          <button
            key={locale}
            type="button"
            onClick={() => handleSwitch(locale)}
            disabled={isPending || isActive}
            className={`rounded-md px-2 py-1 transition ${
              isActive
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {locale.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
