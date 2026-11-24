import Link from "next/link";
import { cookies } from "next/headers";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getApiBaseUrl } from "@/lib/config";
import { getInstances } from "@/lib/admin/instances";
import { createIncusInstance } from "@/lib/admin/provisioning-actions";
import { InstanceTable } from "@/components/instance-table";

type User = { id: string; email: string; customer: { id: string } | null };
type Region = { id: string; code: string; name: string; enabled: boolean };
type Plan = { id: string; name: string; enabled: boolean; vcpu: number; memoryMb: number };
type Image = { id: string; name: string; enabled: boolean; mode: string };

async function adminData<T>(path: string): Promise<T> {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session unavailable");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/${path}`, {
    headers: { Cookie: `kiiro_session=${cookie}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Admin API unavailable (${response.status})`);
  return response.json() as Promise<T>;
}
const input = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white";

export default async function InstancesPage() {
  await requireAdminSession();
  const [instances, catalog] = await Promise.all([
    getInstances().catch(() => null),
    Promise.all([
      adminData<User[]>("users"), adminData<Region[]>("regions"),
      adminData<Plan[]>("plans"), adminData<Image[]>("images"),
    ]).catch(() => null),
  ]);
  return <section className="space-y-7">
    <header>
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Services / Instances</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">VPS instances</h2>
      <p className="mt-2 text-sm text-zinc-400">Create and manage Incus instances. Lifecycle actions and history are available on each instance detail page.</p>
    </header>
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
      <h3 className="text-lg font-medium">Create Incus container</h3>
      <p className="mt-1 text-sm text-zinc-500">Requires an online node, a fresh heartbeat, available resources and an IPv4 address in its node pool.</p>
      {!catalog ? <p role="alert" className="mt-4 text-sm text-zinc-400">Provisioning catalog unavailable.</p> : (() => {
        const [users, regions, plans, images] = catalog;
        return <form action={createIncusInstance} className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="text-xs text-zinc-400">Customer<select required name="customerId" defaultValue="" className={input}><option value="">Select customer</option>{users.filter(u=>u.customer).map(u=><option key={u.id} value={u.customer!.id}>{u.email}</option>)}</select></label>
          <label className="text-xs text-zinc-400">Region<select required name="regionId" defaultValue="" className={input}><option value="">Select region</option>{regions.filter(r=>r.enabled).map(r=><option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></label>
          <label className="text-xs text-zinc-400">Plan<select required name="planId" defaultValue="" className={input}><option value="">Select plan</option>{plans.filter(p=>p.enabled).map(p=><option key={p.id} value={p.id}>{p.name} ({p.vcpu} vCPU / {p.memoryMb} MB)</option>)}</select></label>
          <label className="text-xs text-zinc-400">Image<select required name="imageId" defaultValue="" className={input}><option value="">Select image</option>{images.filter(i=>i.enabled&&i.mode==="REAL").map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
          <label className="text-xs text-zinc-400">Instance name<input required name="name" pattern="[A-Za-z0-9][A-Za-z0-9-]{1,62}" placeholder="vps-example-01" className={input}/></label>
          <div className="flex items-end"><button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">Queue provisioning</button></div>
        </form>;
      })()}
    </section>
    {instances ? <InstanceTable instances={instances}/> : <p role="alert" className="rounded-xl border border-white/15 p-5 text-zinc-300">Instance data unavailable. Check API connectivity.</p>}
    <p className="text-xs text-zinc-500">Select an instance to view lifecycle controls, tasks and events.</p>
    <Link href="/admin/tasks" className="text-sm text-zinc-300 underline hover:text-white">View all tasks</Link>
  </section>;
}
