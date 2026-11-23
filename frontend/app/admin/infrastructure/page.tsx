import { cookies } from "next/headers";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getApiBaseUrl } from "@/lib/config";
import { createNode, removeNode, createPool, removePool, connectNode, disconnectNode } from "@/lib/admin/infrastructure-actions";
import { IpAddressForm } from "./ip-address-form";

type Node = { id: string; name: string; status: string; lastSeenAt: string | null; region: { code: string }; provider: { slug: string }; _count: { instances: number }; totalVcpu: number; reservedVcpu: number; totalMemoryMb: string; reservedMemoryMb: string; totalDiskGb: string; reservedDiskGb: string };
type Inventory = { state: string; checkedAt: string; networks: string[]; storagePools: string[]; resources: { cpu: { total: unknown }; memory: { total: unknown; used: unknown } } | null; certificates: { configured: boolean; serverFingerprint?: string } };
type Pool = { id: string; regionId: string; cidr: string; family: string; gateway: string | null; _count: { addresses: number } };
type Overview = { nodes: Node[]; pools: Pool[]; addresses: { status: string; _count: { _all: number } }[]; instances: number };
type Region = { id: string; name: string; code: string };
type Provider = { id: string; name: string; slug: string };

async function adminFetch<T>(path: string): Promise<T> {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session unavailable");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/${path}`, {
    headers: { Cookie: `kiiro_session=${cookie}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Infrastructure API unavailable (${response.status})`);
  return await response.json() as T;
}

const input = "mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white";
const button = "rounded-md bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950";
export default async function InfrastructurePage() {
  await requireAdminSession();
  const [overview, regions, providers] = await Promise.all([
    adminFetch<Overview>("infrastructure/overview"),
    adminFetch<Region[]>("regions"),
    adminFetch<Provider[]>("infrastructure/providers"),
  ]);
  const inventories = await Promise.all(overview.nodes.map(async n => {
    try { return [n.id, await adminFetch<Inventory>(`infrastructure/nodes/${encodeURIComponent(n.id)}/inventory`)] as const; }
    catch { const fallback: Inventory = { state: "UNAVAILABLE", checkedAt: "", networks: [], storagePools: [], resources: null, certificates: { configured: false } }; return [n.id, fallback] as const; }
  }));
  const inventoryById = new Map(inventories);
  return <main className="space-y-8">
    <header><p className="text-xs uppercase tracking-widest text-amber-400">Infrastructure Management v1.0</p><h1 className="mt-2 text-3xl font-bold">Nodes and IPAM</h1><p className="mt-2 text-slate-400">New nodes are registered OFFLINE. Registration does not establish Incus trust or enable scheduling.</p></header>
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-slate-800 p-5">Nodes: <strong>{overview.nodes.length}</strong></div>
      <div className="rounded-xl border border-slate-800 p-5">Instances: <strong>{overview.instances}</strong></div>
      <div className="rounded-xl border border-slate-800 p-5">IP pools: <strong>{overview.pools.length}</strong></div>
    </div>
    <section className="rounded-xl border border-slate-800 p-5"><h2 className="mb-4 text-xl font-semibold">Register Incus node</h2>
      <form action={createNode} className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">Name<input required maxLength={120} name="name" className={input} placeholder="incus-eu-02"/></label>
        <label className="text-sm">Provider<select required name="providerId" className={input}>{providers.filter(p=>p.slug==="INCUS").map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-sm">Region<select required name="regionId" className={input}>{regions.map(r=><option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></label>
        <button className={button}>Register offline</button>
      </form>
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Compute nodes</h2>
      <div className="grid gap-3 lg:grid-cols-2">{overview.nodes.map(n=><article key={n.id} className="rounded-xl border border-slate-800 p-5">
        <div className="flex items-center justify-between"><h3 className="font-semibold">{n.name}</h3><span className="text-xs text-amber-300">{n.status}</span></div>
        <p className="mt-1 text-xs text-slate-500">{n.id} · {n.provider.slug} · {n.region.code}</p>
        <p className="mt-3 text-sm">Instances: {n._count.instances} · vCPU: {n.reservedVcpu}/{n.totalVcpu}</p>
        <p className="text-sm">RAM MB: {n.reservedMemoryMb}/{n.totalMemoryMb} · Disk GB: {n.reservedDiskGb}/{n.totalDiskGb}</p>
        <p className="mt-2 text-xs text-slate-500">Last seen: {n.lastSeenAt ?? "Never"}</p>
        <div className="mt-3 rounded-lg bg-slate-900 p-3 text-xs text-slate-300"><p>Incus inventory: {inventoryById.get(n.id)?.state ?? "UNAVAILABLE"}</p><p>Networks: {inventoryById.get(n.id)?.networks.join(", ") || "—"}</p><p>Storage pools: {inventoryById.get(n.id)?.storagePools.join(", ") || "—"}</p><p>CPU threads: {String(inventoryById.get(n.id)?.resources?.cpu.total ?? "—")} · Memory bytes: {String(inventoryById.get(n.id)?.resources?.memory.total ?? "—")}</p><p>mTLS: {inventoryById.get(n.id)?.certificates.configured ? "Configured" : "Not configured"}</p></div>
        {n.provider.slug === "INCUS" && (
          <div className="mt-4 flex flex-wrap gap-2">
            {["OFFLINE", "MAINTENANCE"].includes(n.status) && (
              <form action={connectNode}>
                <input type="hidden" name="id" value={n.id} />
                <button
                  type="submit"
                  className="rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  Connect
                </button>
              </form>
            )}

            {["ONLINE", "DEGRADED"].includes(n.status) && (
              <form action={disconnectNode}>
                <input type="hidden" name="id" value={n.id} />
                <button
                  type="submit"
                  className="rounded-md border border-amber-500 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10"
                >
                  Disconnect
                </button>
              </form>
            )}
          </div>
        )}
        {n._count.instances===0 && ["OFFLINE","MAINTENANCE"].includes(n.status) && <form action={removeNode} className="mt-4"><input type="hidden" name="id" value={n.id}/><button className="rounded border border-red-800 px-3 py-2 text-xs text-red-300">Remove empty node</button></form>}
      </article>)}</div>
    </section>
    <section className="rounded-xl border border-slate-800 p-5"><h2 className="mb-4 text-xl font-semibold">Create IP pool</h2>
      <form action={createPool} className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">Region<select name="regionId" className={input}>{regions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label className="text-sm">CIDR<input required name="cidr" className={input} placeholder="192.0.2.0/24"/></label>
        <label className="text-sm">Gateway (optional)<input name="gateway" className={input} placeholder="192.0.2.1"/></label>
        <button className={button}>Create pool</button>
      </form>
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Address pools</h2>{overview.pools.map(p=><article key={p.id} className="rounded-xl border border-slate-800 p-5">
      <h3 className="font-semibold">{p.cidr} <span className="text-xs font-normal text-slate-400">{p.family} · {p._count.addresses} addresses</span></h3>
      <p className="text-xs text-slate-500">Gateway: {p.gateway ?? "Not set"}</p>
      <IpAddressForm poolId={p.id} />
      {p._count.addresses===0 && <form action={removePool} className="mt-3"><input type="hidden" name="id" value={p.id}/><button className="text-xs text-red-300 underline">Remove empty pool</button></form>}
    </article>)}</section>
  </main>;
}
