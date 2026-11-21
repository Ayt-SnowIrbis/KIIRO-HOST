import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getAdminData, type AdminEndpoint } from "@/lib/admin/data";

const sections: Record<string, { title: string; description: string; columns: string[] }> = {
  users: { title: "Users", description: "Customer accounts and access management", columns: ["email", "role", "status", "createdAt"] },
  instances: { title: "VPS instances", description: "Inventory and lifecycle status", columns: ["name", "status", "kind", "vcpu", "memoryMb", "diskGb"] },
  nodes: { title: "Nodes", description: "Hypervisor inventory and capacity (mock nodes are labeled)", columns: ["name", "status", "mode", "totalVcpu", "totalMemoryMb"] },
  regions: { title: "Regions", description: "Infrastructure geography", columns: ["code", "name", "country", "enabled"] },
  plans: { title: "Plans", description: "Compute packages and commercial catalog", columns: ["slug", "name", "vcpu", "memoryMb", "diskGb", "enabled"] },
  images: { title: "OS images", description: "Operating system templates", columns: ["slug", "name", "version", "osFamily", "mode", "enabled"] },
  tasks: { title: "Tasks", description: "Provisioning and background operations", columns: ["type", "status", "instanceId", "attempts", "createdAt"] },
  audit: { title: "Audit log", description: "Security and administrator activity", columns: ["action", "entityType", "entityId", "createdAt"] },
  billing: { title: "Billing", description: "Orders and invoices (read-only)", columns: ["number", "status", "currency", "totalMinor", "createdAt"] },
};

type Row = Record<string, unknown>;
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "—";
}

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  await requireAdminSession();
  const { section } = await params;
  const item = sections[section];
  if (!item) notFound();
  const result = await getAdminData<unknown>(section as AdminEndpoint).catch(() => null);
  const rows: Row[] = Array.isArray(result)
    ? result as Row[]
    : section === "billing" && result && typeof result === "object"
      ? [...((result as { orders?: Row[] }).orders ?? []), ...((result as { invoices?: Row[] }).invoices ?? [])]
      : [];
  return (
    <section className="space-y-6">
      <div>
        <Link href="/admin/dashboard" className="text-sm text-amber-400 hover:underline">← Overview</Link>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">{item.title}</h2>
        <p className="mt-2 text-slate-400">{item.description}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 className="font-semibold">Records</h3>
          <span className="text-xs text-slate-400">{result === null ? "Data unavailable" : `${rows.length} shown · up to 100`}</span>
        </div>
        {result === null ? (
          <p className="p-6 text-sm text-amber-300">Could not load data. Check API connectivity and administrator permissions.</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">No records found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-sm">
              <thead className="bg-slate-800/60 text-xs uppercase tracking-wider text-slate-400">
                <tr>{item.columns.map((col) => <th key={col} scope="col" className="px-5 py-3 font-medium">{col}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row, i) => (
                  <tr key={display(row.id) !== "—" ? display(row.id) : i} className="hover:bg-slate-800/40">
                    {item.columns.map((col) => <td key={col} className="max-w-64 truncate px-5 py-4 text-slate-200" title={display(row[col])}>{display(row[col])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">Read-only management view. Editing actions and filters will be enabled after authorization and audit coverage are tested.</p>
    </section>
  );
}
