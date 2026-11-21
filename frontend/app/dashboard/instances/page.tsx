import Link from "next/link";
import { requireUserSession } from "@/lib/auth/server-session";
import { getCustomerInstances } from "@/lib/customer/instances";

function statusStyle(status: string) {
  if (status === "running") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (status === "stopped") return "border-slate-300 bg-slate-100 text-slate-700";
  if (status === "error" || status === "failed") return "border-rose-300 bg-rose-50 text-rose-800";
  return "border-amber-300 bg-amber-50 text-amber-800";
}

export default async function CustomerInstancesPage() {
  await requireUserSession();
  const instances = await getCustomerInstances().catch(() => null);
  const running = instances?.filter((instance) => instance.status === "running").length ?? 0;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm text-amber-700 hover:underline">← Customer dashboard</Link>
          <p className="mt-4 text-xs uppercase tracking-widest text-amber-600">Compute</p>
          <h2 className="mt-2 text-3xl font-semibold">My VPS instances</h2>
          <p className="mt-2 text-slate-600">View your servers, resource allocations and recent operations.</p>
        </div>
        {instances && instances.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm">
            <span className="font-semibold">{instances.length}</span> total · <span className="font-semibold text-emerald-700">{running}</span> running
          </div>
        )}
      </header>

      {instances === null ? (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <h3 className="font-semibold">VPS data is temporarily unavailable</h3>
          <p className="mt-1 text-sm">Your servers have not been changed. Please reload this page to retry.</p>
          <Link href="/dashboard/instances" className="mt-3 inline-block text-sm font-semibold underline">Retry</Link>
        </div>
      ) : instances.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <h3 className="text-lg font-semibold">No VPS instances yet</h3>
          <p className="mt-2 max-w-xl text-sm text-slate-600">Your servers will appear here after an order has been provisioned. If you have already paid for an order, contact support and include your order reference.</p>
          <Link href="/support" className="mt-5 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Contact support</Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {instances.map((instance) => (
            <Link key={instance.id} href={`/dashboard/instances/${instance.id}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-amber-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold group-hover:text-amber-800">{instance.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">{instance.provider.name} · {instance.region.name} · {instance.kind.toUpperCase()}</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-400">{instance.id}</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${statusStyle(instance.status)}`}>{instance.status.replaceAll("_", " ")}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">
                <p><span className="block text-xs text-slate-500">vCPU</span><b>{instance.vcpu}</b></p>
                <p><span className="block text-xs text-slate-500">Memory</span><b>{instance.memoryMb.toLocaleString()} MB</b></p>
                <p><span className="block text-xs text-slate-500">Disk</span><b>{instance.diskGb} GB</b></p>
                <p><span className="block text-xs text-slate-500">IP address</span><b className="break-all">{instance.addresses.map((address) => address.address).join(", ") || "Not assigned"}</b></p>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
                {instance.hasActiveTask ? <span className="font-medium text-amber-700">An operation is in progress</span> : <span className="text-slate-500">No active operation</span>}
                <span className="font-semibold text-amber-700">Manage VPS →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
