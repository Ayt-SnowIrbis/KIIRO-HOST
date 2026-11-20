import { requireAdminSession } from "@/lib/auth/server-session";
import { getRequestI18n } from "@/lib/i18n/server";

export default async function AdminDashboardPage() {
  const session = await requireAdminSession();

  const { dictionary } = await getRequestI18n();

  return (
    <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div>
        <h2 className="text-2xl font-semibold">{dictionary.dashboard.adminTitle}</h2>
        <p className="mt-2 text-slate-600">{dictionary.dashboard.adminDescription}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm text-slate-500">{dictionary.dashboard.currentSession}</p>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>
            <span className="font-medium">ID:</span> {session.id}
          </li>
          <li>
            <span className="font-medium">Email:</span> {session.email}
          </li>
          <li>
            <span className="font-medium">Role:</span> {session.role}
          </li>
          <li>
            <span className="font-medium">Status:</span> {session.status}
          </li>
        </ul>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        <p className="font-medium text-slate-800">{dictionary.compute.neutralBoundaryTitle}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>/compute/providers</li>
          <li>/compute/instances</li>
          <li>/compute/instances/:id/actions/:action</li>
        </ul>
      </div>

      <form action="/api/auth/logout?next=/login" method="post">
        <button type="submit" className="inline-block text-sm text-slate-700 underline">
          {dictionary.nav.logout}
        </button>
      </form>
    </section>
  );
}
