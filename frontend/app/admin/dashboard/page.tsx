import Link from "next/link";
import { requireAdminSession } from "@/lib/auth/server-session";

const metrics = [
  { label: "Users", value: "—", detail: "Backend integration pending" },
  { label: "VPS instances", value: "—", detail: "Backend integration pending" },
  { label: "Online nodes", value: "—", detail: "Backend integration pending" },
  { label: "Pending tasks", value: "—", detail: "Backend integration pending" },
];

const modules = [
  { title: "Users", description: "Accounts, access and customer profiles", href: "/admin/users" },
  { title: "Instances", description: "VPS inventory and lifecycle operations", href: "/admin/instances" },
  { title: "Nodes", description: "Incus and future Proxmox infrastructure", href: "/admin/nodes" },
  { title: "Plans", description: "Compute packages and availability", href: "/admin/plans" },
  { title: "Tasks", description: "Provisioning and lifecycle job history", href: "/admin/tasks" },
  { title: "Audit log", description: "Administrative activity and security events", href: "/admin/audit" },
];

export default async function AdminDashboardPage() {
  await requireAdminSession();
  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">Overview</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Infrastructure at a glance</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-400">Your central workspace for customers, compute resources and operations.</p>
        </div>
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">Dashboard v2 · Preview</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">{metric.label}</p>
            <p className="mt-4 text-3xl font-semibold text-white">{metric.value}</p>
            <p className="mt-2 text-xs text-slate-500">{metric.detail}</p>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-lg font-semibold">Management</h3>
        <p className="mt-1 text-sm text-slate-400">Module pages will be connected to live data in subsequent commits.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <Link key={module.href} href={module.href} className="group rounded-2xl border border-slate-800 bg-slate-900/50 p-5 transition hover:border-amber-400/50 hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-amber-400">
              <span className="text-base font-semibold text-white group-hover:text-amber-300">{module.title}</span>
              <p className="mt-2 text-sm leading-6 text-slate-400">{module.description}</p>
              <p className="mt-5 text-xs font-medium text-amber-400">Open section →</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
