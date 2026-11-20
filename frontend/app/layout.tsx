import type { Metadata } from "next";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getAuthSession } from "@/lib/auth/server-session";
import { getRequestI18n } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "KIIRO HOST Frontend",
  description: "Starter-kit frontend for multi-provider compute management",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { locale, dictionary } = await getRequestI18n();
  const session = await getAuthSession();

  const currentRoleLabel = session
    ? session.role === "admin"
      ? dictionary.common.roleAdmin
      : dictionary.common.roleUser
    : dictionary.common.roleGuest;

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6">
          <header className="mb-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">{dictionary.common.appName}</p>
                <h1 className="text-lg font-semibold">{dictionary.common.panelTitle}</h1>
              </div>
              <nav className="flex flex-wrap items-center gap-2 text-sm">
                <Link className="rounded-md px-3 py-2 hover:bg-slate-100" href="/">
                  {dictionary.nav.home}
                </Link>
                <Link className="rounded-md px-3 py-2 hover:bg-slate-100" href="/login">
                  {dictionary.nav.login}
                </Link>
                <Link className="rounded-md px-3 py-2 hover:bg-slate-100" href="/register">
                  {dictionary.nav.register}
                </Link>
                <Link className="rounded-md px-3 py-2 hover:bg-slate-100" href="/dashboard">
                  {dictionary.nav.dashboard}
                </Link>
                <Link className="rounded-md px-3 py-2 hover:bg-slate-100" href="/admin/dashboard">
                  {dictionary.nav.adminDashboard}
                </Link>
                <form action="/api/auth/logout?next=/" method="post">
                  <button className="rounded-md px-3 py-2 hover:bg-slate-100" type="submit">
                    {dictionary.nav.logout}
                  </button>
                </form>
              </nav>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {dictionary.auth.currentAuthState}: <span className="font-medium text-slate-700">{currentRoleLabel}</span>
              </p>
              <LanguageSwitcher currentLocale={locale} label={dictionary.common.language} />
            </div>
          </header>
          <main className="flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
