import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getInstances, getInstanceTasks, queueInstanceAction } from "@/lib/admin/instances";
import { InstanceAction } from "@/components/instance-action";

export default async function InstanceDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ queued?: string; error?: string }>;
}) {
  await requireAdminSession();
  const { id } = await params;
  const { queued, error } = await searchParams;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
  const instances = await getInstances().catch(() => null);
  if (!instances) return <p className="text-amber-300">Instance API unavailable. Please retry later.</p>;
  const instance = instances.find((item) => item.id === id);
  if (!instance) notFound();
  const tasks = await getInstanceTasks(id).catch(() => null);
  const activeTask = tasks?.some((task) => task.status === "queued" || task.status === "running") ?? false;
  const mockOnly = true; // Backend independently enforces MOCK Incus restrictions for all writes.

  async function submitAction(formData: FormData) {
    "use server";
    await requireAdminSession();
    const action = formData.get("action");
    if (action !== "start" && action !== "stop" && action !== "reboot") return;
    try {
      await queueInstanceAction(id, action);
    } catch {
      redirect(`/admin/instances/${id}?error=1`);
    }
    revalidatePath(`/admin/instances/${id}`);
    redirect(`/admin/instances/${id}?queued=1`);
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
        </div>
        <p className="mt-2 break-all font-mono text-xs text-slate-500">{instance.id}</p>
      </div>
      {queued && <p role="status" className="rounded-xl border border-emerald-500/40 p-4 text-emerald-300">Operation queued. Refresh this page to see progress.</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-500/40 p-4 text-rose-300">Operation was rejected or failed. Check the task history and API logs.</p>}
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
        <p className="mt-2 text-sm text-slate-400">Only Mock Incus instances are accepted by the backend. Actions are queued, not immediately completed.</p>
        {activeTask && <p className="mt-3 text-sm text-amber-300">An operation is already in progress.</p>}
        <form action={submitAction} className="mt-5 flex flex-wrap gap-4">
          <InstanceAction action="start" name={instance.name} enabled={mockOnly && canStart} />
          <InstanceAction action="stop" name={instance.name} enabled={mockOnly && canStop} />
          <InstanceAction action="reboot" name={instance.name} enabled={mockOnly && canReboot} />
        </form>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-lg font-semibold">Task history</h3>
        {tasks === null ? <p className="mt-4 text-amber-300">Task history unavailable.</p> : tasks.length === 0 ? <p className="mt-4 text-slate-400">No tasks recorded.</p> :
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="text-slate-400"><tr>{["Action", "Status", "Attempts", "Created", "Error"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{tasks.map((task) => <tr key={task.id}><td className="px-3 py-3">{task.type}</td><td className="px-3 py-3">{task.status}</td><td className="px-3 py-3">{task.attempts}</td><td className="px-3 py-3">{new Date(task.createdAt).toLocaleString()}</td><td className="max-w-60 truncate px-3 py-3 text-rose-300">{task.lastError ?? "—"}</td></tr>)}</tbody></table></div>}
      </div>
    </section>
  );
}
