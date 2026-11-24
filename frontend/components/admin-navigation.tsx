"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const sections = [
  { title: "Overview", links: [{ label: "Dashboard", href: "/admin/dashboard", icon: "◫" }] },
  { title: "Infrastructure", links: [
    { label: "Nodes", href: "/admin/nodes", icon: "⬡" },
    { label: "Regions", href: "/admin/regions", icon: "◎" },
    { label: "IPAM", href: "/admin/ipam", icon: "◇" },
  ] },
  { title: "Services", links: [
    { label: "Instances", href: "/admin/instances", icon: "▣" },
    { label: "Plans", href: "/admin/plans", icon: "▤" },
    { label: "Images", href: "/admin/images", icon: "◈" },
  ] },
  { title: "Customers", links: [
    { label: "Users", href: "/admin/users", icon: "♙" },
    { label: "Billing", href: "/admin/billing", icon: "◇" },
    { label: "Support", href: "/admin/support", icon: "✉" },
  ] },
  { title: "Operations", links: [
    { label: "Tasks", href: "/admin/tasks", icon: "☷" },
    { label: "Audit log", href: "/admin/audit", icon: "≡" },
  ] },

];

export function AdminNavigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <aside className="admin-sidebar w-full shrink-0 border-b border-white/10 lg:w-64 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between border-b border-white/10 p-5">
        <Link href="/admin/dashboard" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white font-black text-black">K</span>
          <span><span className="block text-sm font-bold tracking-widest">KIIRO HOST</span><span className="block text-xs text-zinc-500">CONTROL PANEL</span></span>
        </Link>
        <button type="button" className="rounded-lg border border-white/15 px-3 py-2 text-sm lg:hidden" aria-expanded={open} aria-controls="admin-nav-links" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
      </div>
      <nav id="admin-nav-links" aria-label="Admin navigation" className={`${open ? "block" : "hidden"} space-y-6 px-4 py-6 lg:block`}>
        {sections.map(section => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{section.title}</p>
            <div className="space-y-1">
              {section.links.map(link => {
                const active = pathname === link.href || pathname.startsWith(link.href + "/");
                return <Link key={link.href} href={link.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition focus-visible:outline-2 focus-visible:outline-white ${active ? "border border-white/15 bg-white/10 font-semibold text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}>
                  <span aria-hidden="true" className="w-5 text-center text-lg">{link.icon}</span>{link.label}
                </Link>;
              })}
            </div>
          </div>
        ))}
        <Link href="/" className="block border-t border-white/10 px-3 pt-5 text-sm text-zinc-500 hover:text-white">Public website</Link>
      </nav>
    </aside>
  );
}
