import { requireUserSession } from "@/lib/auth/server-session";
import { getRequestI18n } from "@/lib/i18n/server";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await requireUserSession();
  const { dictionary } = await getRequestI18n();
  return (
    <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div>
        <h2 className="text-2xl font-semibold">{dictionary.dashboard.customerTitle}</h2>
        <p className="mt-2 text-slate-600">{dictionary.dashboard.customerDescription}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm text-slate-500">{dictionary.dashboard.currentSession}</p>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li><span className="font-medium">ID:</span> {session.id}</li>
          <li><span className="font-medium">Email:</span> {session.email}</li>
          <li><span className="font-medium">Role:</span> {session.role}</li>
          <li><span className="font-medium">Status:</span> {session.status}</li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard/instances" className="inline-flex rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950">My VPS instances</Link>
        <Link href="/support" className="inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Open Support Desk</Link>
      </div>
      <form action="/api/auth/logout?next=/login" method="post">
        <button type="submit" className="inline-block text-sm text-slate-700 underline">{dictionary.nav.logout}</button>
      </form>
    </section>
  );
}
