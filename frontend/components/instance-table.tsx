"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Instance } from "@/lib/admin/instances";

export function InstanceTable({ instances }: { instances: Instance[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const filtered = useMemo(() => instances.filter((item) => {
    const text = [item.name, item.id, item.node.name, item.region.name].join(" ").toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (status === "all" || item.status === status);
  }), [instances, query, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="flex flex-wrap gap-3 border-b border-slate-800 p-5">
        <label className="flex-1 text-xs text-slate-400">Search instances
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Name, ID, node, region" className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-400" />
        </label>
        <label className="text-xs text-slate-400">Status
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="mt-2 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
            <option value="all">All statuses</option>
            {["running", "stopped", "pending", "provisioning", "error", "deleting"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-slate-800/60 text-xs uppercase tracking-wider text-slate-400"><tr>{["Instance", "Status", "Node", "Region", "Resources", "Details"].map((label) => <th key={label} className="px-5 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">
          {filtered.slice((current - 1) * pageSize, current * pageSize).map((item) => <tr key={item.id} className="hover:bg-slate-800/40">
            <td className="px-5 py-4 font-medium">{item.name}</td><td className="px-5 py-4">{item.status}</td><td className="px-5 py-4">{item.node.name}</td><td className="px-5 py-4">{item.region.code}</td><td className="px-5 py-4">{item.vcpu} CPU / {item.memoryMb} MB</td><td className="px-5 py-4"><Link href={`/admin/instances/${encodeURIComponent(item.id)}`} className="font-medium text-amber-400 hover:underline">Manage →</Link></td>
          </tr>)}
        </tbody>
      </table></div>
      {filtered.length === 0 && <p className="p-5 text-sm text-slate-400">No matching instances.</p>}
      <div className="flex items-center justify-between border-t border-slate-800 px-5 py-4 text-xs text-slate-400">
        <span>{filtered.length} matching · showing {Math.min(filtered.length, pageSize)} per page</span>
        <div className="flex items-center gap-3">
          <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40">Previous</button>
          <span>{current} / {pages}</span>
          <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)} className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
