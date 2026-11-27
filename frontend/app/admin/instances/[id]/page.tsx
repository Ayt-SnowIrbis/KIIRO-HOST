import { SshAccess } from "@/components/ssh-access";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getInstances, getInstanceTasks, getInstanceEvents, queueInstanceAction, queueInstanceResize } from "@/lib/admin/instances";
import { InstanceAction } from "@/components/instance-action";
import { deleteIncusInstance } from "@/lib/admin/provisioning-actions";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";

export default async function InstanceDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ queued?: string; error?: string; resized?: string; resizeError?: string }>;
}) {
  await requireAdminSession();
  const { id } = await params;
  const { queued, error, resized, resizeError } = await searchParams;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
  const instances = await getInstances().catch(() => null);
  if (!instances) return <p className="text-amber-300">Instance API unavailable. Please retry later.</p>;
  const instance = instances.find((item) => item.id === id);
  if (!instance) notFound();
  const [tasks, events] = await Promise.all([
    getInstanceTasks(id).catch(() => null),
    getInstanceEvents(id).catch(() => null),
  ]);
  const activeTask = tasks?.some((task) => task.status === "queued" || task.status === "running") ?? false;
  const resizeEnabled = tasks !== null && instance.status === "stopped" && instance.mode === "real" && instance.provider.slug === "incus" && instance.node.status === "ONLINE";
  const lifecycleEnabled = (instance.mode === "mock" || instance.mode === "real") && instance.provider.slug === "incus" && instance.node.status === "ONLINE";

  async function submitAction(formData: FormData) {
    "use server";
    await requireAdminSession();
    const action = formData.get("action");
    if (action !== "start" && action !== "stop" && action !== "reboot") return;
    try { await queueInstanceAction(id, action); }
    catch { redirect(`/admin/instances/${id}?error=1`); }
    revalidatePath(`/admin/instances/${id}`);
    redirect(`/admin/instances/${id}?queued=1`);
  }

  async function submitResize(formData: FormData) {
    "use server";
    await requireAdminSession();
    const vcpu = Number(formData.get("vcpu"));
    const memoryMb = Number(formData.get("memoryMb"));
    const diskGb = Number(formData.get("diskGb"));
    if (![vcpu, memoryMb, diskGb].every((value) => Number.isSafeInteger(value) && value > 0)) {
      redirect(`/admin/instances/${id}?resizeError=invalid`);
    }
    if (memoryMb % 1024 !== 0) redirect(`/admin/instances/${id}?resizeError=memory-step`);
    try { await queueInstanceResize(id, { vcpu, memoryMb, diskGb }); }
    catch { redirect(`/admin/instances/${id}?resizeError=rejected`); }
    revalidatePath("/admin/instances");
    revalidatePath(`/admin/instances/${id}`);
    redirect(`/admin/instances/${id}?resized=1`);
  }

  const canStart = instance.status === "stopped" && !activeTask;
  const canStop = instance.status === "running" && !activeTask;
  const canReboot = instance.status === "running" && !activeTask;

  return (
    <section className="space-y-7">
      <div>
        <Link href="/admin/instances" className="text-sm text-amber-400 hover:underline">← All instances</Link>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <h2 className="text-3xl font-semibold text-white">{instance.name}</h2>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase text-slate-300">{instance.status}</span>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase text-slate-400">{instance.mode}</span>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-slate-500">{instance.id}</p>
      </div>
      {queued && <p role="status" className="rounded-xl border border-emerald-500/40 p-4 text-emerald-300">Operation queued. Refresh this page to see progress.</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-500/40 p-4 text-rose-300">Operation was rejected or failed. Check the task history and API logs.</p>}
      {resized && <p role="status" className="rounded-xl border border-emerald-500/40 p-4 text-emerald-300">Resize task queued. New resources appear after the worker completes it.</p>}
      {resizeError && <p role="alert" className="rounded-xl border border-rose-500/40 p-4 text-rose-300">Resize rejected. Check provider mode, node capacity, current tasks and requested values.</p>}
      <SshAccess id={id} admin={true} enabled={tasks !== null && !activeTask && lifecycleEnabled && instance.mode === "real" && instance.status === "running"} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Provider", instance.provider.name], ["Node", instance.node.name], ["Region", instance.region.name],
          ["Type", instance.kind], ["vCPU", String(instance.vcpu)], ["RAM", `${instance.memoryMb} MB`],
          ["Disk", `${instance.diskGb} GB`], ["Created", new Date(instance.createdAt).toLocaleString()],
          ["IP addresses", instance.addresses.map((address) => address.address).join(", ") || "Not assigned"],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 break-words font-medium">{value}</p></div>)}
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-lg font-semibold">Lifecycle controls</h3>
        <p className="mt-2 text-sm text-slate-400">Lifecycle actions are queued for online Incus nodes. Real operations require a separately enabled API driver and worker.</p>
        {activeTask && <p className="mt-3 text-sm text-amber-300">An operation is already in progress.</p>}
        <form action={submitAction} className="mt-5 flex flex-wrap gap-4">
          <InstanceAction action="start" name={instance.name} enabled={lifecycleEnabled && canStart} />
          <InstanceAction action="stop" name={instance.name} enabled={lifecycleEnabled && canStop} />
          <InstanceAction action="reboot" name={instance.name} enabled={lifecycleEnabled && canReboot} />
        </form>
      </div>
      {instance.mode === "real" && !["deleted", "deleting"].includes(instance.status) && <div className="rounded-2xl border border-rose-900/40 p-6">
        <h3 className="text-lg font-semibold">Delete instance</h3>
        <p className="mt-2 text-sm text-zinc-400">Destructive action: deletes the Incus container and releases managed resources and IPAM after successful worker execution. Back up data first.</p>
        <form action={deleteIncusInstance} className="mt-4">
          <input type="hidden" name="instanceId" value={instance.id}/>
          <ConfirmDeleteButton name={instance.name} disabled={activeTask || tasks === null || !lifecycleEnabled} />
        </form>
      </div>}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-lg font-semibold">Resize resources</h3>
        <p className="mt-2 text-sm text-slate-400">Available for stopped managed Incus containers on online nodes.</p>
        {!resizeEnabled && <p className="mt-3 text-sm text-amber-300">Stop the instance and ensure the node and task history are available.</p>}
        <form action={submitResize} className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="text-xs text-slate-400">vCPU<input name="vcpu" type="number" min="1" max="256" required defaultValue={instance.vcpu} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label>
          <label className="text-xs text-slate-400">Memory (MB)<input name="memoryMb" type="number" min="1024" step="1024" max="1048576" required defaultValue={instance.memoryMb} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label>
          <label className="text-xs text-slate-400">Disk (GB)<input name="diskGb" type="number" min={instance.diskGb} max="100000" required defaultValue={instance.diskGb} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label>
          <div className="sm:col-span-3"><button disabled={!resizeEnabled || activeTask} className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">Queue resize</button></div>
        </form>
        <p className="mt-3 text-xs text-slate-500">Disk shrink is disabled to prevent data loss. Resize is blocked while another operation is active.</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-lg font-semibold">Task history</h3>
        {tasks === null ? <p className="mt-4 text-amber-300">Task history unavailable.</p> : tasks.length === 0 ? <p className="mt-4 text-slate-400">No tasks recorded.</p> :
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="text-slate-400"><tr>{["Action", "Status", "Attempts", "Created", "Error"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{tasks.map((task) => <tr key={task.id}><td className="px-3 py-3">{task.type}</td><td className="px-3 py-3">{task.status}</td><td className="px-3 py-3">{task.attempts}</td><td className="px-3 py-3">{new Date(task.createdAt).toLocaleString()}</td><td className="max-w-60 truncate px-3 py-3 text-rose-300">{task.lastError ?? "—"}</td></tr>)}</tbody></table></div>}
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-lg font-semibold">Instance event history</h3>
        {events === null ? <p className="mt-4 text-amber-300">Event history unavailable.</p> : events.length === 0 ? <p className="mt-4 text-slate-400">No events recorded.</p> :
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="text-slate-400"><tr><th className="px-3 py-3">Event</th><th className="px-3 py-3">Time</th><th className="px-3 py-3">Details</th></tr></thead><tbody className="divide-y divide-slate-800">{events.map((event) => <tr key={event.id}><td className="px-3 py-3">{event.eventType}</td><td className="px-3 py-3">{new Date(event.createdAt).toLocaleString()}</td><td className="max-w-80 truncate px-3 py-3 text-slate-400">{JSON.stringify(event.payload)}</td></tr>)}</tbody></table></div>}
      </div>
    </section>
  );
}
