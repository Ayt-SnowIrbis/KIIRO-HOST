import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/server-session";

const sections: Record<string, { title: string; description: string }> = {
  users: { title: "Users", description: "Customer accounts and access management" },
  instances: { title: "VPS instances", description: "Inventory, status and lifecycle operations" },
  nodes: { title: "Nodes", description: "Hypervisor inventory and resource capacity" },
  regions: { title: "Regions", description: "Infrastructure geography and availability" },
  plans: { title: "Plans", description: "Compute packages and commercial catalog" },
  images: { title: "OS images", description: "Operating system templates" },
  tasks: { title: "Tasks", description: "Provisioning and background operations" },
  audit: { title: "Audit log", description: "Security and administrator activity" },
  billing: { title: "Billing", description: "Orders, payments and invoicing" },
};

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  await requireAdminSession();
  const { section } = await params;
  const item = sections[section];
  if (!item) notFound();

  return (
    <section className="space-y-6">
      <div>
        <Link href="/admin/dashboard" className="text-sm text-amber-400 hover:underline">← Overview</Link>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">{item.title}</h2>
        <p className="mt-2 text-slate-400">{item.description}</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
        <p className="text-lg font-medium text-white">Module under development</p>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
          The navigation is ready. Live data, permissions, filters and administrative actions
          will be implemented and tested before this module becomes operational.
        </p>
      </div>
    </section>
  );
}
