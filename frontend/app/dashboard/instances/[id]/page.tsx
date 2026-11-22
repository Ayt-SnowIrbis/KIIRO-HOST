import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserSession } from "@/lib/auth/server-session";
import { getCustomerInstance, getCustomerInstanceTasks, getCustomerInstanceEvents, queueCustomerInstanceAction } from "@/lib/customer/instances";
import { CustomerInstancePowerControls } from "@/components/customer-instance-power-controls";

export default async function CustomerInstanceDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ queued?: string; error?: string }>;
}) {
  await requireUserSession();
  const { id } = await params;
  const query = await searchParams;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
  const instance = await getCustomerInstance(id).catch(() => null);
  if (!instance) notFound();
  const [tasks, events] = await Promise.all([
    getCustomerInstanceTasks(id).catch(() => null),
    getCustomerInstanceEvents(id).catch(() => null),
  ]);
  const activeTask = tasks?.some((task) => task.status === "queued" || task.status === "running") ?? true;
  const lifecycleEnabled = (instance.mode === "mock" || instance.mode === "real") && instance.provider.slug === "incus" && instance.node.status === "ONLINE";
  const canStart = instance.status === "stopped" && !activeTask;
  const canStop = instance.status === "running" && !activeTask;
  const canReboot = instance.status === "running" && !activeTask;

  async function submitAction(formData: FormData) {
    "use server";
    await requireUserSession();
    const action = formData.get("action");
    if (action !== "start" && action !== "stop" && action !== "reboot") return;
    try {
      await queueCustomerInstanceAction(id, action);
    } catch {
      redirect(`/dashboard/instances/${id}?error=1`);
    }
    revalidatePath("/dashboard/instances");
    revalidatePath(`/dashboard/instances/${id}`);
    redirect(`/dashboard/instances/${id}?queued=1`);
  }

  const addresses = instance.addresses;
  const primaryAddress = addresses.find((address) => address.isPrimary) ?? addresses[0];

  return (
    <section className="space-y-7">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/instances" className="text-sm text-amber-700 hover:underline">← My VPS instances</Link>
          <Link href={`/dashboard/instances/${id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">Refresh status</Link>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h2 className="text-3xl font-semibold">{instance.name}</h2>
          <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase">{instance.status.replaceAll("_", " ")}</span>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-slate-500">{instance.id}</p>
      </header>

      {query.queued && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">Operation accepted and queued. The VPS state will update after the worker confirms completion. Refresh this page to check progress.</p>}
      {query.error && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">The operation was rejected. No successful change was reported. Check the task history or contact support.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Provider", instance.provider.name],
          ["Node", instance.node.name],
          ["Region", instance.region.name],
          ["Operating system", instance.image ? `${instance.image.name} ${instance.image.version}` : "Not reported"],
          ["Type", instance.kind.toUpperCase()],
          ["vCPU", String(instance.vcpu)],
          ["RAM", `${instance.memoryMb.toLocaleString()} MB`],
          ["Disk", `${instance.diskGb} GB`],
          ["Created", new Date(instance.createdAt).toLocaleString()],
          ["IP addresses", addresses.map((address) => address.address).join(", ") || "Not assigned"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 break-words font-medium">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Network access</h3>
        {primaryAddress ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-xs text-slate-500">Primary IP address</p><p className="mt-1 font-mono font-semibold">{primaryAddress.address}</p></div>
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs">{primaryAddress.family}</span>
          </div>
        ) : <p className="mt-2 text-sm text-slate-500">No IP address has been assigned to this VPS yet.</p>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Power controls</h3>
        <p className="mt-2 text-sm text-slate-600">Operations are queued and processed asynchronously. The displayed state changes only after the worker reports completion.</p>
        {activeTask && <p className="mt-3 text-sm text-amber-700">Another operation is queued or running. New actions are temporarily disabled.</p>}
        {!lifecycleEnabled && <p className="mt-3 text-sm text-amber-700">The node is offline or its lifecycle driver is unavailable. The API performs the final authorization check.</p>}
        <form action={submitAction}>
          <CustomerInstancePowerControls name={instance.name} canStart={lifecycleEnabled && canStart} canStop={lifecycleEnabled && canStop} canReboot={lifecycleEnabled && canReboot} />
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Task history</h3>
          <span className="text-xs text-slate-500">Latest 50 operations</span>
        </div>
        {tasks === null ? <p className="mt-3 text-amber-700">Task history unavailable. Refresh to retry.</p> : tasks.length === 0 ? <p className="mt-3 text-sm text-slate-500">No tasks recorded.</p>
          : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-slate-500"><tr>{["Action", "Status", "Attempts", "Created", "Error"].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{tasks.map((task) => <tr key={task.id}><td className="px-3 py-3">{task.type.replaceAll("_", " ")}</td><td className="px-3 py-3"><span className="rounded-full border border-slate-200 px-2 py-1 text-xs">{task.status}</span></td><td className="px-3 py-3">{task.attempts}</td><td className="px-3 py-3">{new Date(task.createdAt).toLocaleString()}</td><td className="max-w-64 truncate px-3 py-3 text-rose-700" title={task.lastError ?? undefined}>{task.lastError ?? "—"}</td></tr>)}</tbody></table></div>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Event history</h3>
          <span className="text-xs text-slate-500">Latest 100 events</span>
        </div>
        {events === null ? <p className="mt-3 text-amber-700">Event history unavailable. Refresh to retry.</p> : events.length === 0 ? <p className="mt-3 text-sm text-slate-500">No events recorded.</p>
          : <div className="mt-4 space-y-3">{events.map((event) => <div key={event.id} className="border-l-2 border-slate-300 pl-4"><p className="font-medium">{event.eventType.replaceAll("_", " ")}</p><p className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString()}</p><pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600">{JSON.stringify(event.payload, null, 2)}</pre></div>)}</div>}
      </div>
    </section>
  );
}
