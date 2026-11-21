import Link from "next/link";
import { requireUserSession } from "@/lib/auth/server-session";
import { getCustomerInstances } from "@/lib/customer/instances";

export default async function CustomerInstancesPage() {
  await requireUserSession();
  const instances = await getCustomerInstances().catch(() => null);
  return (
    <section className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-amber-600">Compute</p>
        <h2 className="mt-2 text-3xl font-semibold">My VPS instances</h2>
        <p className="mt-2 text-slate-600">Manage your virtual servers, inspect resources and review operations.</p>
      </header>
      {instances === null ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">VPS data is temporarily unavailable. Please retry later.</p>
        : instances.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-8"><h3 className="font-semibold">No VPS instances yet</h3><p className="mt-2 text-sm text-slate-600">Your servers will appear here after an order has been provisioned.</p></div>
        : <div className="grid gap-4">
          {instances.map((i) => <Link key={i.id} href={`/dashboard/instances/${i.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-amber-400">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-lg font-semibold">{i.name}</h3><p className="mt-1 text-xs text-slate-500">{i.provider.name} · {i.region.name} · {i.kind.toUpperCase()}</p></div>
              <span className="rounded-full border border-slate-300 px-3 py-1 text-xs uppercase">{i.status}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <p><span className="text-slate-500">vCPU</span><br/><b>{i.vcpu}</b></p>
              <p><span className="text-slate-500">RAM</span><br/><b>{i.memoryMb} MB</b></p>
              <p><span className="text-slate-500">Disk</span><br/><b>{i.diskGb} GB</b></p>
              <p><span className="text-slate-500">IP</span><br/><b>{i.addresses.map((a) => a.address).join(", ") || "Not assigned"}</b></p>
            </div>
            {i.hasActiveTask && <p className="mt-3 text-xs text-amber-700">An operation is in progress</p>}
          </Link>)}
        </div>}
    </section>
  );
}
