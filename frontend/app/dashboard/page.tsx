import Link from "next/link";
import { requireUserSession } from "@/lib/auth/server-session";
import { getRequestI18n } from "@/lib/i18n/server";

export default async function DashboardPage() {
  const session = await requireUserSession();
  const { dictionary } = await getRequestI18n();
  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold">{dictionary.dashboard.customerTitle}</h2>
        <p className="mt-2 text-slate-600">{dictionary.dashboard.customerDescription}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href="/dashboard/instances" className="rounded-xl border border-amber-300 bg-amber-50 p-5 transition hover:border-amber-500">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Compute</p>
            <h3 className="mt-2 text-lg font-semibold">My VPS instances</h3>
            <p className="mt-1 text-sm text-slate-600">View server status, IP addresses, resources and operation history.</p>
            <span className="mt-4 inline-block text-sm font-semibold text-amber-800">Manage VPS →</span>
          </Link>
          <Link href="/support" className="rounded-xl border border-slate-200 bg-slate-50 p-5 transition hover:border-slate-400">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Help center</p>
            <h3 className="mt-2 text-lg font-semibold">Support Desk</h3>
            <p className="mt-1 text-sm text-slate-600">Create a ticket and communicate with the support team.</p>
            <span className="mt-4 inline-block text-sm font-semibold">Open support →</span>
          </Link>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">{dictionary.dashboard.currentSession}</p>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li><span className="font-medium">ID:</span> {session.id}</li>
          <li><span className="font-medium">Email:</span> {session.email}</li>
          <li><span className="font-medium">Role:</span> {session.role}</li>
          <li><span className="font-medium">Status:</span> {session.status}</li>
        </ul>
      </div>
      <form action="/api/auth/logout?next=/login" method="post">
        <button type="submit" className="inline-block text-sm text-slate-700 underline">{dictionary.nav.logout}</button>
      </form>
    </section>
  );
}
