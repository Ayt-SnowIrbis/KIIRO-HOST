import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserSession } from "@/lib/auth/server-session";
import { getCustomerInstance } from "@/lib/customer/instances";
import { InstanceConsole } from "@/components/instance-console";

export default async function CustomerConsolePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserSession();
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) notFound();
  const instance = await getCustomerInstance(id).catch(() => null);
  if (!instance) notFound();
  return (
    <section className="space-y-6">
      <header>
        <Link href={`/dashboard/instances/${id}`} className="text-sm text-amber-700 hover:underline">← Back to VPS details</Link>
        <h1 className="mt-3 text-2xl font-semibold">Console — {instance.name}</h1>
        <p className="mt-1 text-sm text-slate-500">Instance {instance.id}</p>
      </header>
      <InstanceConsole instanceId={id} admin={false} />
    </section>
  );
}
