import Link from "next/link";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getInstances } from "@/lib/admin/instances";
import { InstanceTable } from "@/components/instance-table";

export default async function InstancesPage() {
  await requireAdminSession();
  const instances = await getInstances().catch(() => null);
  return (
    <section className="space-y-6">
      <div>
        <Link href="/admin/dashboard" className="text-sm text-amber-400 hover:underline">← Overview</Link>
        <h2 className="mt-4 text-3xl font-semibold text-white">VPS instances</h2>
        <p className="mt-2 text-slate-400">Find an instance, inspect its details and manage supported Mock Incus lifecycle operations.</p>
      </div>
      {instances ? <InstanceTable instances={instances} /> : <p role="alert" className="rounded-xl border border-amber-500/40 p-5 text-amber-300">Instance data unavailable. Check API connectivity.</p>}
    </section>
  );
}
