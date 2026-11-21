import { AdminNavigation } from "@/components/admin-navigation";
import type { ReactNode } from "react";
import { requireAdminSession } from "@/lib/auth/server-session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminSession();

  return (
    <div className="min-h-[75vh] overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1220] text-slate-100 shadow-2xl">
      <div className="flex min-h-[75vh] flex-col lg:flex-row">
        <AdminNavigation />
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-amber-400">Control center</p>
              <h1 className="mt-1 text-lg font-semibold">Administration</h1>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="max-w-48 truncate text-slate-400">{session.email}</span>
              <form action="/api/auth/logout?next=/login" method="post">
                <button type="submit" className="rounded-lg border border-slate-700 px-3 py-2 hover:bg-slate-800">Sign out</button>
              </form>
            </div>
          </header>
          <main className="p-5 sm:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
