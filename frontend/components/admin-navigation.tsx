"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const sections = [
  { title: "Workspace", links: [{ label: "Overview", href: "/admin/dashboard", icon: "◫" }] },
  { title: "Management", links: [
    { label: "Users", href: "/admin/users", icon: "♙" },
    { label: "Instances", href: "/admin/instances", icon: "▣" },
    { label: "Nodes", href: "/admin/nodes", icon: "⬡" },
    { label: "Regions", href: "/admin/regions", icon: "◎" },
    { label: "Plans", href: "/admin/plans", icon: "▤" },
    { label: "Images", href: "/admin/images", icon: "◈" },
  ] },
  { title: "Operations", links: [
    { label: "Tasks", href: "/admin/tasks", icon: "☷" },
    { label: "Audit log", href: "/admin/audit", icon: "≡" },
    { label: "Billing", href: "/admin/billing", icon: "◇" },
  ] },
];

export function AdminNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <aside className="w-full shrink-0 border-b border-slate-800 bg-[#0e1728] lg:w-64 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between p-5">
        <Link href="/admin/dashboard" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 font-black text-slate-950">K</span>
          <span><span className="block text-sm font-bold tracking-widest">KIIRO HOST</span><span className="block text-xs text-slate-400">Administration</span></span>
        </Link>
        <button type="button" className="rounded-lg border border-slate-700 px-3 py-2 text-sm lg:hidden" aria-expanded={open} aria-controls="admin-nav-links" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
      </div>
      <nav id="admin-nav-links" aria-label="Admin navigation" className={`${open ? "block" : "hidden"} space-y-6 px-5 pb-6 lg:block`}>
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{section.title}</p>
            <div className="space-y-1">
              {section.links.map((link) => {
                const active = pathname === link.href || (link.href === "/admin/instances" && pathname.startsWith("/admin/instances/"));
                return <Link key={link.href} href={link.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition focus-visible:outline-2 focus-visible:outline-amber-400 ${active ? "bg-amber-400/15 font-semibold text-amber-300" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
                  <span aria-hidden="true" className="w-5 text-center text-lg">{link.icon}</span>{link.label}
                </Link>;
              })}
            </div>
          </div>
        ))}
        <Link href="/" className="block border-t border-slate-800 px-3 pt-5 text-sm text-slate-400 hover:text-white">← Public website</Link>
      </nav>
    </aside>
  );
}
