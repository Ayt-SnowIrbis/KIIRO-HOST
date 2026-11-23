import { cookies } from "next/headers";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getApiBaseUrl } from "@/lib/config";
import { configureNodeProvisioning, createIncusInstance, deleteIncusInstance, createInfrastructureRegion, moveNodeToRegion, configureIncusImageAlias } from "@/lib/admin/provisioning-actions";

type Node = {
  id: string; name: string; status: string; heartbeatAgeSeconds: number | null;
  region: { code: string; name: string };
  totalVcpu: number; reservedVcpu: number;
  totalMemoryMb: string; reservedMemoryMb: string;
  totalDiskGb: string; reservedDiskGb: string;
  provisioning: { network?: string; storagePool?: string; enabled?: boolean } | null;
  inventory: { networks?: string[]; storagePools?: string[] } | null;
};
type Task = { id: string; type: string; status: string; instanceId: string | null; lastError: string | null; createdAt: string };
type Monitoring = { nodes: Node[]; tasks: Task[]; failedTasksLast24h: number };
type User = { id: string; email: string; customer: { id: string; displayName: string | null } | null };
type Region = { id: string; code: string; name: string; enabled: boolean };
type Plan = { id: string; name: string; enabled: boolean; vcpu: number; memoryMb: number; diskGb: number };
type Image = { id: string; name: string; enabled: boolean; mode: string };
type Instance = { id: string; name: string; status: string; mode: string; node: { name: string }; addresses: { address: string }[] };
async function api<T>(path: string): Promise<T> {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session required");
  const response = await fetch(getApiBaseUrl().replace(new RegExp("/$"), "") + "/compute/" + path, {
    headers: { Cookie: "kiiro_session=" + cookie }, cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Provisioning API error " + response.status);
  return response.json() as Promise<T>;
}
const input = "mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white";
const button = "rounded bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950";
export default async function ProvisioningPage() {
  await requireAdminSession();
  const [monitor, users, regions, plans, images, instances] = await Promise.all([
    api<Monitoring>("admin/provisioning/monitoring"),
    api<User[]>("admin/users"),
    api<Region[]>("admin/regions"),
    api<Plan[]>("admin/plans"),
    api<Image[]>("admin/images"),
    api<Instance[]>("instances"),
  ]);
  return <main className="space-y-8">
    <header>
      <p className="text-xs uppercase tracking-widest text-amber-400">Incus Infrastructure v3</p>
      <h1 className="mt-2 text-3xl font-bold">VPS Provisioning & Monitoring</h1>
      <p className="mt-2 text-slate-400">Only container operations through Incus. Physical node administration stays on SSH.</p>
    </header>
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-lg border border-slate-800 p-4">Nodes: <b>{monitor.nodes.length}</b></div>
      <div className="rounded-lg border border-slate-800 p-4">Instances: <b>{instances.length}</b></div>
      <div className="rounded-lg border border-slate-800 p-4">Failed tasks (24h): <b>{monitor.failedTasksLast24h}</b></div>
    </div>
    <section className="rounded-lg border border-slate-800 p-5">
      <h2 className="mb-4 text-xl font-semibold">Register region</h2>
      <form action={createInfrastructureRegion} className="grid gap-3 md:grid-cols-4">
        <label className="text-xs">Code<input required name="code" maxLength={16} className={input} placeholder="EU-NL"/></label>
        <label className="text-xs">Name<input required name="name" className={input} placeholder="Netherlands"/></label>
        <label className="text-xs">Country ISO-2<input required name="country" maxLength={2} className={input} placeholder="NL"/></label>
        <button className={button}>Create region</button>
      </form>
    </section>
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Node capacity & configuration</h2>
      <div className="grid gap-3 xl:grid-cols-2">{monitor.nodes.map(n=><article key={n.id} className="rounded-lg border border-slate-800 p-4">
        <div className="flex justify-between gap-2"><b>{n.name}</b><span>{n.status}</span></div>
        <p className="text-xs text-slate-400">{n.region.code} · Heartbeat: {n.heartbeatAgeSeconds === null ? "Never" : n.heartbeatAgeSeconds + "s ago"}</p>
        <p className="mt-2 text-sm">vCPU: {n.reservedVcpu}/{n.totalVcpu} · RAM MB: {n.reservedMemoryMb}/{n.totalMemoryMb} · Disk GB: {n.reservedDiskGb}/{n.totalDiskGb}</p>
        {["OFFLINE", "MAINTENANCE"].includes(n.status) && <form action={moveNodeToRegion} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="nodeId" value={n.id}/>
          <select required name="regionId" className={input}><option value="">Move to region (empty node only)</option>{regions.filter(r=>r.enabled).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
          <button className={button}>Move region</button>
        </form>}
        <form action={configureNodeProvisioning} className="mt-4 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="nodeId" value={n.id}/>
          <label className="text-xs">Incus network<input required name="network" defaultValue={n.provisioning?.network ?? ""} list={"net-" + n.id} className={input}/><datalist id={"net-" + n.id}>{(n.inventory?.networks ?? []).map(v=><option key={v} value={v}/>)}</datalist></label>
          <label className="text-xs">Storage pool<input required name="storagePool" defaultValue={n.provisioning?.storagePool ?? ""} list={"pool-" + n.id} className={input}/><datalist id={"pool-" + n.id}>{(n.inventory?.storagePools ?? []).map(v=><option key={v} value={v}/>)}</datalist></label>
          <button className={button}>Save config</button>
        </form>
      </article>)}</div>
    </section>
    <section className="rounded-lg border border-slate-800 p-5">
      <h2 className="mb-4 text-xl font-semibold">Incus image aliases</h2>
      <p className="mb-3 text-sm text-slate-400">Configure the image alias available on the target Incus node.</p>
      {images.filter(i=>i.enabled && i.mode==="REAL").map(i=><form key={i.id} action={configureIncusImageAlias} className="mb-3 grid gap-3 md:grid-cols-3">
        <input type="hidden" name="imageId" value={i.id}/>
        <span className="self-center text-sm">{i.name}</span>
        <input required name="alias" className={input} placeholder="ubuntu/24.04"/>
        <button className={button}>Save alias</button>
      </form>)}
    </section>
    <section className="rounded-lg border border-slate-800 p-5">
      <h2 className="mb-4 text-xl font-semibold">Create Incus container</h2>
      <p className="mb-4 text-sm text-slate-400">Requires an ONLINE node with fresh heartbeat, configured network/storage, sufficient capacity, and a free IPv4 address from its own pool.</p>
      <form action={createIncusInstance} className="grid gap-3 md:grid-cols-3">
        <label className="text-xs">Customer<select required name="customerId" className={input}><option value="">Select customer</option>{users.filter(u=>u.customer).map(u=><option key={u.id} value={u.customer!.id}>{u.email}</option>)}</select></label>
        <label className="text-xs">Region<select required name="regionId" className={input}><option value="">Select region</option>{regions.filter(r=>r.enabled).map(r=><option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></label>
        <label className="text-xs">Plan<select required name="planId" className={input}><option value="">Select plan</option>{plans.filter(p=>p.enabled).map(p=><option key={p.id} value={p.id}>{p.name} ({p.vcpu} vCPU, {p.memoryMb} MB)</option>)}</select></label>
        <label className="text-xs">Image<select required name="imageId" className={input}><option value="">Select image</option>{images.filter(i=>i.enabled&&i.mode==="REAL").map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <label className="text-xs">Instance name<input required name="name" pattern="[A-Za-z0-9][A-Za-z0-9-]{1,62}" placeholder="vps-example-01" className={input}/></label>
        <button className={button}>Queue provisioning</button>
      </form>
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Instances</h2>
      {instances.map(i=><article key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 p-4">
        <div><b>{i.name}</b><p className="text-xs text-slate-400">{i.id} · {i.node.name} · {i.mode} · {i.status} · {i.addresses.map(a=>a.address).join(", ") || "No IP"}</p></div>
        {i.mode==="real" && i.status!=="deleting" && <form action={deleteIncusInstance}><input type="hidden" name="instanceId" value={i.id}/><button className="rounded border border-red-800 px-3 py-2 text-xs text-red-300">Queue delete</button></form>}
      </article>)}
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Recent tasks</h2>
      {monitor.tasks.map(t=><article key={t.id} className="rounded-lg border border-slate-800 p-3 text-xs">
        <b>{t.type} · {t.status}</b><p className="text-slate-400">{t.instanceId ?? "—"} · {t.createdAt}</p>{t.lastError && <p className="mt-1 text-red-300">{t.lastError}</p>}
      </article>)}
    </section>
  </main>;
}
