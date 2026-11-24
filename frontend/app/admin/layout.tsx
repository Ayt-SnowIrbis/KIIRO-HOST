import { AdminNavigation } from "@/components/admin-navigation";
import type { ReactNode } from "react";
import { requireAdminSession } from "@/lib/auth/server-session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminSession();
  return (
    <div className="admin-workspace min-h-screen bg-[#f4f6f8] text-slate-800">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <AdminNavigation />
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-6 py-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">KIIRO / CONTROL</p>
              <h1 className="mt-1 text-lg font-semibold tracking-tight">Administration</h1>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="max-w-48 truncate text-slate-600">{session.email}</span>
              <form action="/api/auth/logout?next=/login" method="post">
                <button type="submit" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 transition hover:bg-slate-50">Sign out</button>
              </form>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1600px] p-5 sm:p-8 lg:p-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
