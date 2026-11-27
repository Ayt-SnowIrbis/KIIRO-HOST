import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getInstances } from "@/lib/admin/instances";
import { InstanceConsole } from "@/components/instance-console";

export default async function AdminConsolePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
  const instances = await getInstances().catch(() => null);
  const instance = instances?.find(item => item.id === id);
  if (!instance) notFound();
  return (
    <section className="space-y-6">
      <header>
        <Link href={`/admin/instances/${id}`} className="text-sm text-amber-400 hover:underline">← Back to VPS details</Link>
        <h1 className="mt-3 text-2xl font-semibold text-white">Console — {instance.name}</h1>
        <p className="mt-1 text-sm text-slate-400">Instance {instance.id}</p>
      </header>
      <InstanceConsole instanceId={id} admin />
    </section>
  );
}
