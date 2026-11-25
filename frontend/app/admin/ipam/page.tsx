import { cookies } from "next/headers";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getApiBaseUrl } from "@/lib/config";
import { createPool, removePool, removePoolAddress } from "@/lib/admin/infrastructure-actions";
import { bindPoolToNode } from "@/lib/admin/provisioning-actions";
import { IpAddressForm } from "../infrastructure/ip-address-form";

type Node = { id: string; name: string; region: { code: string }; provider: { slug: string } };
type Region = { id: string; code: string; name: string };
type Pool = { addresses: { id: string; address: string; status: string; instanceId: string | null }[]; id: string; nodeId: string | null; regionId: string; cidr: string; family: string; gateway: string | null };
type Overview = { nodes: Node[]; pools: Pool[]; addresses: { status: string; _count: { _all: number } }[] };
async function api<T>(path: string): Promise<T> {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session unavailable");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/${path}`, {
    headers: { Cookie: `kiiro_session=${cookie}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`IPAM API unavailable (${response.status})`);
  return response.json() as Promise<T>;
}
const input = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white";
const button = "rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200";
export default async function IpamPage() {
  await requireAdminSession();
  const [overview, regions, pools] = await Promise.all([api<Overview>("infrastructure/overview"), api<Region[]>("regions"), api<Pool[]>("infrastructure/pools")]);
  return <section className="space-y-8">
    <header><p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Infrastructure / IPAM</p><h2 className="mt-2 text-3xl font-semibold">IP address management</h2><p className="mt-2 text-sm text-zinc-400">Address pools, node bindings and address allocation. Assigned addresses are managed by the instance lifecycle.</p></header>
    <div className="grid gap-3 sm:grid-cols-3">{overview.addresses.map(item=><div key={item.status} className="rounded-xl border border-white/10 p-4"><p className="text-xs text-zinc-500">{item.status}</p><p className="mt-2 text-2xl font-semibold">{item._count._all}</p></div>)}</div>
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
      <h3 className="text-lg font-medium">Create IP pool</h3>
      <form action={createPool} className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-xs text-zinc-400">Region<select name="regionId" required className={input}>{regions.map(r=><option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></label>
        <label className="text-xs text-zinc-400">Node<select name="nodeId" required defaultValue="" className={input}><option value="">Select node</option>{overview.nodes.filter(n=>n.provider.slug.toUpperCase()==="INCUS").map(n=><option key={n.id} value={n.id}>{n.name} ({n.region.code})</option>)}</select></label>
        <label className="text-xs text-zinc-400">CIDR<input name="cidr" required placeholder="203.0.113.0/24" className={input}/></label>
        <label className="text-xs text-zinc-400">Gateway (optional)<input name="gateway" placeholder="203.0.113.1" className={input}/></label>
        <div className="md:col-span-4"><button className={button}>Create pool</button></div>
      </form>
    </section>
    <section className="space-y-3"><h3 className="text-lg font-medium">Address pools</h3>
      {pools.map(pool=><article key={pool.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">{pool.cidr}</h4><p className="mt-1 text-xs text-zinc-500">{pool.family} · {pool.addresses.length} addresses · {overview.nodes.find(n=>n.id===pool.nodeId)?.name ?? "Unassigned"} · Gateway {pool.gateway ?? "—"}</p></div>
          {pool.addresses.length===0 && <form action={removePool}><input type="hidden" name="id" value={pool.id}/><button className="rounded border border-rose-900 px-3 py-2 text-xs text-rose-300">Remove empty pool</button></form>}
        </div>
        {!pool.nodeId && <form action={bindPoolToNode} className="mt-4 flex flex-wrap items-end gap-3"><input type="hidden" name="poolId" value={pool.id}/><label className="text-xs text-zinc-400">Bind to node<select required name="nodeId" defaultValue="" className={input}><option value="">Select node</option>{overview.nodes.filter(n=>n.provider.slug.toUpperCase()==="INCUS" && n.region.code===regions.find(r=>r.id===pool.regionId)?.code).map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label><button className={button}>Bind</button></form>}
        <div className="mt-4"><IpAddressForm poolId={pool.id}/></div><div className="mt-4 space-y-2"><h5 className="text-sm font-semibold">Addresses on this node</h5>{(pool.addresses ?? []).length === 0 ? <p className="text-xs text-zinc-500">No addresses registered.</p> : (pool.addresses ?? []).map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm"><span className="font-mono">{a.address}</span><span>{a.status}</span><span className="text-xs text-slate-500">{a.instanceId ? `Instance ID: ${a.instanceId}` : "Not assigned"}</span>{a.status === "AVAILABLE" && !a.instanceId && <form action={removePoolAddress}><input type="hidden" name="addressId" value={a.id}/><button className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700">Remove</button></form>}</div>)}</div>
      </article>)}
    </section>
  </section>;
}
