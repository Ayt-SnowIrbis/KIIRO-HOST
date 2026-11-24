import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getApiBaseUrl } from "@/lib/config";
import { getAdminData } from "@/lib/admin/data";
import { getInstances, type Instance } from "@/lib/admin/instances";

type Overview = { users: number; instances: number; runningInstances: number; queuedTasks: number };
type Node = {
  id: string; name: string; status: string; heartbeatAgeSeconds: number | null;
  region: { code: string }; totalVcpu: number; reservedVcpu: number;
  totalMemoryMb: string; reservedMemoryMb: string; totalDiskGb: string; reservedDiskGb: string;
};
type Task = { id: string; type: string; status: string; createdAt: string; lastError: string | null };
type Monitoring = { nodes: Node[]; tasks: Task[]; failedTasksLast24h: number };
type Ticket = { id: string; status: string; priority: string; subject: string };
const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const muted = "text-sm text-slate-500";

async function adminApi<T>(path: string): Promise<T> {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session unavailable");
  const response = await fetch(`${getApiBaseUrl().replace(/\\/$/, "")}/compute/admin/${path}`, {
    headers: { Cookie: `kiiro_session=${cookie}` },
    cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Admin API HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
function pct(used: number, total: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.round((used / total) * 100));
}
function Capacity({ label, used, total, unit }: { label: string; used: number; total: number; unit: string }) {
  const percent = pct(used, total);
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-700">{percent === null ? "Not reported" : `${used.toLocaleString()} / ${total.toLocaleString()} ${unit} · ${percent}%`}</span>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={label} aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {percent !== null && <div className={`h-full rounded-full ${percent >= 90 ? "bg-rose-500" : percent >= 75 ? "bg-amber-500" : "bg-slate-600"}`} style={{ width: `${Math.min(percent, 100)}%` }}/>}
    </div>
  </div>;
}
function Metric({ title, value, detail, href }: { title: string; value: number | string; detail: string; href: string }) {
  return <Link href={href} className={`${card} block transition hover:border-slate-400 focus-visible:outline-2 focus-visible:outline-slate-600`}>
    <p className={muted}>{title}</p><p className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
    <p className="mt-2 text-xs text-slate-500">{detail}</p>
  </Link>;
}
export default async function AdminDashboardPage() {
  await requireAdminSession();
  const [overviewResult, monitoringResult, instancesResult, ticketsResult] = await Promise.allSettled([
    getAdminData<Overview>("overview"),
    adminApi<Monitoring>("provisioning/monitoring"),
    getInstances(),
    adminApi<Ticket[]>("support/tickets"),
  ]);
  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  const monitoring = monitoringResult.status === "fulfilled" ? monitoringResult.value : null;
  const instances: Instance[] | null = instancesResult.status === "fulfilled" ? instancesResult.value : null;
  const tickets = ticketsResult.status === "fulfilled" ? ticketsResult.value : null;
  const nodes = monitoring?.nodes ?? [];
  const online = nodes.filter(n => n.status === "ONLINE");
  const problematic = nodes.filter(n => n.status !== "ONLINE");
  const realInstances = instances?.filter(i => i.mode === "real") ?? [];
  const running = realInstances.filter(i => i.status === "RUNNING").length;
  const stopped = realInstances.filter(i => ["STOPPED", "STOPPING"].includes(i.status)).length;
  const other = realInstances.length - running - stopped;
  const openTickets = tickets?.filter(t => !["RESOLVED", "CLOSED"].includes(t.status)) ?? [];
  const urgentTickets = openTickets.filter(t => ["HIGH", "URGENT", "CRITICAL"].includes(t.priority));
  const activeTasks = monitoring?.tasks.filter(t => ["QUEUED", "PENDING", "RUNNING", "PROCESSING"].includes(t.status)) ?? [];
  const failedTasks = monitoring?.tasks.filter(t => t.status === "FAILED") ?? [];
  return <section className="space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Operations / Overview</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Infrastructure overview</h2>
        <p className="mt-2 text-sm text-slate-500">Live API snapshot · capacity allocation, node health and operational exceptions.</p></div>
      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">Dashboard v3 · refreshed on page load</span>
    </header>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric title="Compute nodes online" value={monitoring ? online.length : "—"} detail={monitoring ? `${problematic.length} offline / degraded · ${nodes.length} registered` : "Monitoring unavailable"} href="/admin/nodes"/>
      <Metric title="Real VPS running" value={instances ? running : "—"} detail={instances ? `${stopped} stopped · ${other} other · ${realInstances.length} total` : "Instance data unavailable"} href="/admin/instances"/>
      <Metric title="Open support tickets" value={tickets ? openTickets.length : "—"} detail={tickets ? `${urgentTickets.length} high priority / urgent` : "Support data unavailable"} href="/admin/support"/>
      <Metric title="Failed tasks · 24h" value={monitoring ? monitoring.failedTasksLast24h : "—"} detail={monitoring ? `${activeTasks.length} active in recent task window` : "Task monitoring unavailable"} href="/admin/tasks"/>
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <section className={card}>
        <div className="flex justify-between gap-3"><div><h3 className="text-lg font-semibold">Node capacity & heartbeat</h3>
          <p className="mt-1 text-xs text-slate-500">Reserved resources / configured capacity · not actual host CPU or RAM utilization</p></div>
          <Link href="/admin/nodes" className="text-sm font-medium text-slate-600 underline">Nodes</Link></div>
        {!monitoring ? <p role="alert" className="mt-5 text-sm text-rose-600">Node monitoring unavailable.</p> :
          nodes.length === 0 ? <p className="mt-5 text-sm text-slate-500">No nodes registered.</p> :
          <div className="mt-5 space-y-5">{nodes.map(n => <article key={n.id} className="rounded-xl border border-slate-200 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-semibold text-slate-800">{n.name}</p><p className="text-xs text-slate-500">{n.region.code} · heartbeat {n.heartbeatAgeSeconds === null ? "unavailable" : `${n.heartbeatAgeSeconds}s ago`}</p></div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${n.status === "ONLINE" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{n.status}</span>
            </div>
            <div className="space-y-3">
              <Capacity label="vCPU reserved" used={n.reservedVcpu} total={n.totalVcpu} unit="vCPU"/>
              <Capacity label="RAM reserved" used={Number(n.reservedMemoryMb)} total={Number(n.totalMemoryMb)} unit="MB"/>
              <Capacity label="Disk reserved" used={Number(n.reservedDiskGb)} total={Number(n.totalDiskGb)} unit="GB"/>
            </div>
          </article>)}</div>}
      </section>
      <div className="space-y-5">
        <section className={card}><h3 className="text-lg font-semibold">VPS inventory</h3>
          <p className="mt-1 text-xs text-slate-500">Real instances only; mock excluded</p>
          {instances ? <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[[running, "Running"], [stopped, "Stopped"], [other, "Other"]].map(([count, label]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-2xl font-semibold tabular-nums">{count}</p><p className="text-xs text-slate-500">{label}</p></div>)}
          </div> : <p className="mt-4 text-sm text-rose-600">Instance inventory unavailable.</p>}
        </section>
        <section className={card}><div className="flex justify-between gap-2"><h3 className="text-lg font-semibold">Support queue</h3><Link href="/admin/support" className="text-sm text-slate-600 underline">Tickets</Link></div>
          {tickets ? <><p className="mt-3 text-2xl font-semibold">{openTickets.length} <span className="text-sm font-normal text-slate-500">unresolved</span></p>
            <p className="mt-1 text-xs text-slate-500">{urgentTickets.length} high priority / urgent</p>
            <div className="mt-3 space-y-2">{openTickets.slice(0, 4).map(t => <Link key={t.id} href={`/admin/support/${encodeURIComponent(t.id)}`} className="block truncate rounded-lg bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100">{t.subject} <span className="text-xs text-slate-500">· {t.status}</span></Link>)}</div>
          </> : <p className="mt-3 text-sm text-rose-600">Support queue unavailable.</p>}
        </section>
        <section className={card}><h3 className="text-lg font-semibold">Customers & operations</h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Registered accounts</span><Link href="/admin/users" className="font-semibold">{overview?.users ?? "—"}</Link></div>
            <div className="flex justify-between"><span className="text-slate-500">Queued / running tasks</span><Link href="/admin/tasks" className="font-semibold">{overview?.queuedTasks ?? "—"}</Link></div>
            <div className="flex justify-between"><span className="text-slate-500">Degraded / offline nodes</span><span className="font-semibold">{monitoring ? problematic.length : "—"}</span></div>
          </div>
        </section>
      </div>
    </div>
    <section className={card}><div className="flex justify-between gap-3"><div><h3 className="text-lg font-semibold">Recent operations & errors</h3>
      <p className="mt-1 text-xs text-slate-500">Latest provisioning and lifecycle tasks</p></div><Link href="/admin/tasks" className="text-sm text-slate-600 underline">All tasks</Link></div>
      {!monitoring ? <p role="alert" className="mt-4 text-sm text-rose-600">Task history unavailable.</p> :
        monitoring.tasks.length === 0 ? <p className="mt-4 text-sm text-slate-500">No recent tasks.</p> :
        <div className="mt-4 divide-y divide-slate-100">{[...failedTasks, ...monitoring.tasks.filter(t => t.status !== "FAILED")].slice(0, 8).map(t => <div key={t.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
          <span className="min-w-24 font-medium">{t.type}</span><span className={t.status === "FAILED" ? "font-semibold text-rose-600" : "text-slate-600"}>{t.status}</span>
          <span className="ml-auto text-xs text-slate-500">{new Date(t.createdAt).toLocaleString()}</span>
          {t.lastError && <p className="w-full break-words text-xs text-rose-600">{t.lastError}</p>}
        </div>)}</div>}
    </section>
  </section>;
}
