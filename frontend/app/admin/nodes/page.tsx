import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getApiBaseUrl } from "@/lib/config";
import { createNode, connectNode, disconnectNode, removeNode } from "@/lib/admin/infrastructure-actions";
import { updateAdminRecord } from "@/lib/admin/actions";
import { configureNodeProvisioning, moveNodeToRegion } from "@/lib/admin/provisioning-actions";

type Node = {
  id: string; name: string; status: string; lastSeenAt: string | null;
  region: { code: string }; provider: { slug: string };
  _count: { instances: number };
  totalVcpu: number; reservedVcpu: number;
  totalMemoryMb: string; reservedMemoryMb: string;
  totalDiskGb: string; reservedDiskGb: string;
};
type Inventory = { state: string; checkedAt: string; networks: string[]; storagePools: string[]; certificates: { configured: boolean } };
type Config = { network?: string; storagePool?: string; networkMode?: string; parent?: string; enabled?: boolean };
type MonitoringNode = { id: string; provisioning: Config | null; heartbeatAgeSeconds: number | null; inventory?: { networks?: string[]; storagePools?: string[] } };
type Region = { id: string; name: string; code: string; enabled: boolean };
type Provider = { id: string; name: string; slug: string };
type Overview = { nodes: Node[] };

async function api<T>(path: string): Promise<T> {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session unavailable");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/${path}`, {
    headers: { Cookie: `kiiro_session=${cookie}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Node API failed (${response.status})`);
  return response.json() as Promise<T>;
}
const input = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white";
const primary = "rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200";
const secondary = "rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:bg-white/10";

export default async function NodesPage() {
  await requireAdminSession();
  const [overview, regions, providers, monitoring] = await Promise.all([
    api<Overview>("infrastructure/overview"),
    api<Region[]>("regions"),
    api<Provider[]>("infrastructure/providers"),
    api<{ nodes: MonitoringNode[] }>("provisioning/monitoring"),
  ]);
  const configs = new Map(monitoring.nodes.map(node => [node.id, node]));
  const inventory = new Map(monitoring.nodes.map(node => [node.id, node.inventory ?? null] as const));
  return <section className="space-y-8">
    <header>
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Infrastructure / Nodes</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">Compute nodes</h2>
      <p className="mt-2 text-sm text-zinc-400">Registration, configuration, connectivity and maintenance of Incus nodes. Physical host operations remain on SSH.</p>
    </header>
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
      <h3 className="text-lg font-medium">Register a node</h3>
      <p className="mt-1 text-sm text-zinc-500">New nodes are registered offline. Trust and connectivity must be configured before activation.</p>
      <form action={createNode} className="mt-5 grid gap-4 md:grid-cols-4">
        <label className="text-xs text-zinc-400">Name<input required maxLength={120} name="name" placeholder="incus-eu-02" className={input}/></label>
        <label className="text-xs text-zinc-400">Provider<select required name="providerId" className={input}>{providers.filter(p => p.slug.toUpperCase() === "INCUS").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-xs text-zinc-400">Region<select required name="regionId" className={input}>{regions.filter(r => r.enabled).map(r => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></label>
        <div className="flex items-end"><button className={primary}>Register offline</button></div>
      </form>
    </section>
    <div className="grid gap-5 xl:grid-cols-2">
      {overview.nodes.map(node => {
        const cfg = configs.get(node.id)?.provisioning;
        const health = inventory.get(node.id);
        const regionName = regions.find(r => r.code === node.region.code)?.name ?? node.region.code;
        const canRemove = node._count.instances === 0 && ["OFFLINE", "MAINTENANCE"].includes(node.status);
        return <article key={node.id} className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.025] p-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="text-lg font-semibold">{node.name}</h3><p className="mt-1 break-all font-mono text-xs text-zinc-500">{node.id}</p><p className="mt-2 text-xs text-zinc-400">{node.provider.slug} · {regionName} ({node.region.code})</p></div>
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs">{node.status}</span>
          </header>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-zinc-500">vCPU</p><b>{node.reservedVcpu} / {node.totalVcpu}</b></div>
            <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-zinc-500">RAM MB</p><b>{node.reservedMemoryMb} / {node.totalMemoryMb}</b></div>
            <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-zinc-500">Disk GB</p><b>{node.reservedDiskGb} / {node.totalDiskGb}</b></div>
          </div>
          <div className="text-xs text-zinc-400">
            <p>Inventory: {health ? "Last reported" : "Not reported"} · Heartbeat age: {configs.get(node.id)?.heartbeatAgeSeconds ?? "—"} seconds</p>
            <p>Networks: {health?.networks?.join(", ") || "—"} · Storage: {health?.storagePools?.join(", ") || "—"}</p>
            <p>Managed instances: {node._count.instances} · Last heartbeat: {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : "Never"}</p>
          </div>
          <form action={updateAdminRecord} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="entity" value="nodes"/><input type="hidden" name="id" value={node.id}/>
            <label className="text-xs text-zinc-400">Node name<input name="name" defaultValue={node.name} className={input}/></label>
            <div className="text-xs text-zinc-400">Operational state<p className="mt-1 rounded-lg border border-white/10 px-3 py-2 text-sm text-white">{node.status}</p><p className="mt-1 text-zinc-500">Use Connect / Disconnect controls below; live health is verified separately.</p></div>
            <label className="text-xs text-zinc-400">Total vCPU<input name="totalVcpu" type="number" min={node.reservedVcpu} defaultValue={node.totalVcpu} className={input}/></label>
            <label className="text-xs text-zinc-400">Total RAM MB<input name="totalMemoryMb" type="number" min={Number(node.reservedMemoryMb)} defaultValue={node.totalMemoryMb} className={input}/></label>
            <label className="text-xs text-zinc-400">Total disk GB<input name="totalDiskGb" type="number" min={Number(node.reservedDiskGb)} defaultValue={node.totalDiskGb} className={input}/></label>
            <div className="flex items-end"><button className={secondary}>Save node</button></div>
          </form>
          {node.provider.slug.toUpperCase() === "INCUS" && <form action={configureNodeProvisioning} className="grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-2">
            <input type="hidden" name="nodeId" value={node.id}/>
            <h4 className="sm:col-span-2 font-medium">Incus provisioning configuration</h4>
            <label className="text-xs text-zinc-400">Network mode<select name="networkMode" defaultValue={cfg?.networkMode ?? "bridged"} className={input}><option value="bridged">Bridged</option><option value="routed">Routed</option></select></label>
            <label className="text-xs text-zinc-400">Parent interface<input name="parent" defaultValue={cfg?.parent ?? ""} placeholder="ens160" className={input}/></label>
            <label className="text-xs text-zinc-400">Incus network<input required name="network" defaultValue={cfg?.network ?? ""} list={`network-${node.id}`} className={input}/><datalist id={`network-${node.id}`}>{(health?.networks ?? []).map(x => <option key={x} value={x}/>)}</datalist></label>
            <label className="text-xs text-zinc-400">Storage pool<input required name="storagePool" defaultValue={cfg?.storagePool ?? ""} list={`storage-${node.id}`} className={input}/><datalist id={`storage-${node.id}`}>{(health?.storagePools ?? []).map(x => <option key={x} value={x}/>)}</datalist></label>
            <div className="sm:col-span-2"><button className={secondary}>Save provisioning config</button></div>
          </form>}
          {["OFFLINE", "MAINTENANCE"].includes(node.status) && node._count.instances === 0 && <form action={moveNodeToRegion} className="flex flex-wrap items-end gap-3 border-t border-white/10 pt-4">
            <input type="hidden" name="nodeId" value={node.id}/>
            <label className="text-xs text-zinc-400">Move empty node to region<select name="regionId" required className={input}><option value="">Select region</option>{regions.filter(r => r.enabled).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <button className={secondary}>Move</button>
          </form>}
          <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            {["OFFLINE", "MAINTENANCE"].includes(node.status) && <form action={connectNode}><input type="hidden" name="id" value={node.id}/><button className={secondary}>Connect</button></form>}
            {["ONLINE", "DEGRADED"].includes(node.status) && <form action={disconnectNode}><input type="hidden" name="id" value={node.id}/><button className={secondary}>Disconnect</button></form>}
            {canRemove && <form action={removeNode}><input type="hidden" name="id" value={node.id}/><button className="rounded-lg border border-rose-900 px-4 py-2 text-sm text-rose-300 hover:bg-rose-950/30">Remove empty node</button></form>}
            <Link href="/admin/instances" className="ml-auto text-xs text-zinc-400 underline hover:text-white">View instances</Link>
          </footer>
        </article>;
      })}
    </div>
  </section>;
}
