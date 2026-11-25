import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getAdminData, getNodeConnectivity } from "@/lib/admin/data";

type Node = {
  id: string; name: string; status: string; lastSeenAt: string | null;
  region: { name: string; code: string }; provider: { name: string; slug: string };
  totalVcpu: number; reservedVcpu: number; totalMemoryMb: string; reservedMemoryMb: string;
  totalDiskGb: string; reservedDiskGb: string; _count?: { instances: number };
};
type MonitoringNode = { id: string; heartbeatAgeSeconds: number | null; provisioning?: { network?: string; storagePool?: string; networkMode?: string; parent?: string; enabled?: boolean }; inventory?: { networks?: string[]; storagePools?: string[] } };
export default async function NodeDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
  const nodes = await getAdminData<Node[]>("nodes").catch(() => null);
  if (!nodes) return <p role="alert" className="rounded-xl border border-white/10 p-5">Node API unavailable. No changes have been made.</p>;
  const node = nodes.find(n => n.id === id);
  if (!node) notFound();
  const [connectivity, monitor, pools] = await Promise.all([
    getNodeConnectivity(id).catch(() => null),
    (async () => {
      const { cookies } = await import("next/headers");
      const { getApiBaseUrl } = await import("@/lib/config");
      const cookie = (await cookies()).get("kiiro_session")?.value;
      if (!cookie) return null;
      const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/provisioning/monitoring`, { headers: { Cookie: `kiiro_session=${cookie}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      const payload = await response.json() as { nodes: MonitoringNode[] };
      return payload.nodes.find(n => n.id === id) ?? null;
    })().catch(() => null),
    getAdminData<{id:string;nodeId:string|null;cidr:string;addresses:{id:string;address:string;status:string;instanceId:string|null}[]}[]>("infrastructure/pools").catch(()=>null),
  ]);
  const metrics = [
    { label: "vCPU allocated / total", value: `${node.reservedVcpu} / ${node.totalVcpu}` },
    { label: "RAM allocated / total (MB)", value: `${node.reservedMemoryMb} / ${node.totalMemoryMb}` },
    { label: "Disk allocated / total (GB)", value: `${node.reservedDiskGb} / ${node.totalDiskGb}` },
  ];
  return <section className="space-y-7">
    <header>
      <Link href="/admin/nodes" className="text-sm text-zinc-400 underline hover:text-white">← All nodes</Link>
      <p className="mt-5 text-xs uppercase tracking-[0.18em] text-zinc-500">Infrastructure / Nodes / Overview</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{node.name}</h2>
      <p className="mt-2 break-all font-mono text-xs text-zinc-500">{node.id}</p>
    </header>
    <div className="grid gap-4 md:grid-cols-3">
      {metrics.map(m => <div key={m.label} className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><p className="text-xs text-zinc-500">{m.label}</p><p className="mt-2 text-xl font-semibold">{m.value}</p></div>)}
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <article className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-6">
        <h3 className="text-lg font-medium">Health & connectivity</h3>
        <p className="text-sm">Administrative status: <b>{node.status}</b></p>
        <p className="text-sm">API connectivity: <b>{connectivity?.state ?? "Unavailable"}</b></p>
        <p className="text-sm">Heartbeat age: <b>{monitor?.heartbeatAgeSeconds ?? "Unavailable"} seconds</b></p>
        <p className="text-sm text-zinc-400">Last heartbeat: {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : "Never"}</p>
        <p className="text-xs text-zinc-500">Heartbeat and connectivity are independent of administrative state.</p>
      </article>
      <article className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-6">
        <h3 className="text-lg font-medium">Provisioning configuration</h3>
        <p className="text-sm">Network mode: {monitor?.provisioning?.networkMode ?? "Not configured"}</p>
        <p className="text-sm">Parent interface: {monitor?.provisioning?.parent ?? "—"}</p>
        <p className="text-sm">Network: {monitor?.provisioning?.network ?? "—"}</p>
        <p className="text-sm">Storage pool: {monitor?.provisioning?.storagePool ?? "—"}</p>
        <p className="text-sm text-zinc-400">Reported networks: {monitor?.inventory?.networks?.join(", ") || "—"}</p>
        <p className="text-sm text-zinc-400">Reported storage: {monitor?.inventory?.storagePools?.join(", ") || "—"}</p>
      </article>
    </div>
    <article className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
      <h3 className="text-lg font-medium">Node IP addresses</h3>
      {pools === null ? <p>IPAM unavailable</p> : pools.filter(p=>p.nodeId===id).map(p=><div key={p.id} className="mt-3"><p className="font-medium">{p.cidr}</p>{p.addresses.map(a=><div key={a.id} className="flex flex-wrap gap-3 py-2 text-sm"><span className="font-mono">{a.address}</span><span>{a.status}</span>{a.instanceId && <Link href={`/admin/instances/${encodeURIComponent(a.instanceId)}`}>Open instance</Link>}</div>)}</div>)}
      <Link href="/admin/ipam" className="text-sm underline">Manage IPAM</Link>
      <h3 className="mt-6 text-lg font-medium">Administration</h3>
      <p className="mt-2 text-sm text-zinc-400">Region: {node.region.name} ({node.region.code}) · Provider: {node.provider.name} · Managed instances: {node._count?.instances ?? "—"}</p>
      <p className="mt-2 text-sm text-zinc-400">Node registration, configuration, region transfer and removal are available in Nodes. Host reboot and OS operations remain SSH-only.</p>
      <Link href="/admin/nodes" className="mt-4 inline-block rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10">Manage node</Link>
    </article>
  </section>;
}
