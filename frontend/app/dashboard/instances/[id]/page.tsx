import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUserSession } from "@/lib/auth/server-session";
import { getCustomerInstance, getCustomerInstanceTasks, getCustomerInstanceEvents, queueCustomerInstanceAction } from "@/lib/customer/instances";

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
  const activeTask = tasks?.some((t) => t.status === "queued" || t.status === "running") ?? true;
  const mockEnabled = instance.mode === "mock" && instance.provider.slug === "incus" && instance.node.status === "ONLINE";
  const canStart = instance.status === "stopped" && !activeTask;
  const canStop = instance.status === "running" && !activeTask;
  const canReboot = instance.status === "running" && !activeTask;

  async function submitAction(formData: FormData) {
    "use server";
    await requireUserSession();
    const action = formData.get("action");
    if (action !== "start" && action !== "stop" && action !== "reboot") return;
    try { await queueCustomerInstanceAction(id, action); }
    catch { redirect(`/dashboard/instances/${id}?error=1`); }
    revalidatePath("/dashboard/instances");
    revalidatePath(`/dashboard/instances/${id}`);
    redirect(`/dashboard/instances/${id}?queued=1`);
  }

  return (
    <section className="space-y-7">
      <div>
        <Link href="/dashboard/instances" className="text-sm text-amber-700 hover:underline">← My VPS instances</Link>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h2 className="text-3xl font-semibold">{instance.name}</h2>
          <span className="rounded-full border border-slate-300 px-3 py-1 text-xs uppercase">{instance.status}</span>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-slate-500">{instance.id}</p>
      </div>
      {query.queued && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">Operation queued. Refresh to follow its progress.</p>}
      {query.error && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">The operation was rejected. Review the task history or contact support.</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Provider", instance.provider.name], ["Node", instance.node.name], ["Region", instance.region.name],
          ["Operating system", instance.image ? `${instance.image.name} ${instance.image.version}` : "Not reported"],
          ["Type", instance.kind.toUpperCase()], ["vCPU", String(instance.vcpu)],
          ["RAM", `${instance.memoryMb} MB`], ["Disk", `${instance.diskGb} GB`],
          ["Created", new Date(instance.createdAt).toLocaleString()],
          ["IP addresses", instance.addresses.map((a) => a.address).join(", ") || "Not assigned"],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs text-slate-500">{label}</p><p className="mt-2 break-words font-medium">{value}</p>
        </div>)}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Power controls</h3>
        <p className="mt-2 text-sm text-slate-600">Operations are queued and processed asynchronously. The server status changes only after the worker reports completion.</p>
        {activeTask && <p className="mt-3 text-sm text-amber-700">An operation is already queued or running.</p>}
        {!mockEnabled && <p className="mt-3 text-sm text-amber-700">Live hypervisor controls are not enabled for this instance yet. No simulated success will be reported.</p>}
        <form action={submitAction} className="mt-5 flex flex-wrap gap-3">
          <button name="action" value="start" disabled={!mockEnabled || !canStart} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-40">Start</button>
          <button name="action" value="stop" disabled={!mockEnabled || !canStop} className="rounded-lg bg-rose-600 px-4 py-2 font-semibold text-white disabled:opacity-40">Stop</button>
          <button name="action" value="reboot" disabled={!mockEnabled || !canReboot} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-40">Reboot</button>
        </form>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Task history</h3>
        {tasks === null ? <p className="mt-3 text-amber-700">Task history unavailable.</p> : tasks.length === 0 ? <p className="mt-3 text-sm text-slate-500">No tasks recorded.</p>
          : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-slate-500"><tr>{["Action", "Status", "Attempts", "Created", "Error"].map((x) => <th key={x} className="px-3 py-2">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{tasks.map((t) => <tr key={t.id}><td className="px-3 py-3">{t.type}</td><td className="px-3 py-3">{t.status}</td><td className="px-3 py-3">{t.attempts}</td><td className="px-3 py-3">{new Date(t.createdAt).toLocaleString()}</td><td className="max-w-64 truncate px-3 py-3 text-rose-700">{t.lastError ?? "—"}</td></tr>)}</tbody></table></div>}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="text-lg font-semibold">Event history</h3>
        {events === null ? <p className="mt-3 text-amber-700">Event history unavailable.</p> : events.length === 0 ? <p className="mt-3 text-sm text-slate-500">No events recorded.</p>
          : <div className="mt-4 space-y-3">{events.map((e) => <div key={e.id} className="border-l-2 border-slate-300 pl-4"><p className="font-medium">{e.eventType}</p><p className="text-xs text-slate-500">{new Date(e.createdAt).toLocaleString()}</p><pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(e.payload, null, 2)}</pre></div>)}</div>}
      </div>
    </section>
  );
}
