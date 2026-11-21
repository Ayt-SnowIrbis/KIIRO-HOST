import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdminSession } from "@/lib/auth/server-session";

const sections = [
  {
    title: "Workspace",
    links: [{ label: "Overview", href: "/admin/dashboard" }],
  },
  {
    title: "Management",
    links: [
      { label: "Users", href: "/admin/users" },
      { label: "Instances", href: "/admin/instances" },
      { label: "Nodes", href: "/admin/nodes" },
      { label: "Regions", href: "/admin/regions" },
      { label: "Plans", href: "/admin/plans" },
      { label: "Images", href: "/admin/images" },
    ],
  },
  {
    title: "Operations",
    links: [
      { label: "Tasks", href: "/admin/tasks" },
      { label: "Audit log", href: "/admin/audit" },
      { label: "Billing", href: "/admin/billing" },
    ],
  },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireAdminSession();

  return (
    <div className="min-h-[75vh] overflow-hidden rounded-2xl border border-slate-800 bg-[#0b1220] text-slate-100 shadow-2xl">
      <div className="flex min-h-[75vh] flex-col lg:flex-row">
        <aside className="w-full shrink-0 border-b border-slate-800 bg-[#0e1728] p-5 lg:w-64 lg:border-b-0 lg:border-r">
          <Link href="/admin/dashboard" className="flex items-center gap-3 rounded-xl px-2 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 font-black text-slate-950">K</span>
            <span>
              <span className="block text-sm font-bold tracking-widest">KIIRO HOST</span>
              <span className="block text-xs text-slate-400">Administration</span>
            </span>
          </Link>
          <nav aria-label="Admin navigation" className="mt-7 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-1">
            {sections.map((section) => (
              <div key={section.title}>
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{section.title}</p>
                <div className="space-y-1">
                  {section.links.map((link) => (
                    <Link key={link.href} href={link.href} className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-400">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>
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
