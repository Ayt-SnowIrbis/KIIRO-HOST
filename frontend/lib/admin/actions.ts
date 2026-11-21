"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "@/lib/config";

export async function updateAdminRecord(formData: FormData) {
  const entity = String(formData.get("entity") ?? "");
  const id = String(formData.get("id") ?? "");
  const allowed = ["users", "nodes", "regions", "plans", "images"] as const;
  if (!allowed.includes(entity as typeof allowed[number]) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error("Invalid management request");
  }
  const fields: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "entity" || key === "id" || typeof value !== "string" || value === "") continue;
    if (key === "enabled") fields.enabled = value === "true";
    else if (key === "status" && entity === "users") fields.status = value;
    else if (key === "role" && entity === "users") fields.role = value;
    else if (key === "status" && entity === "nodes") fields.status = value;
    else if (["name","code","country","description"].includes(key)) fields[key] = value;
    else if (["vcpu","memoryMb","diskGb","sortOrder","totalVcpu","reservedVcpu"].includes(key)) {
      const n = Number(value); if (!Number.isSafeInteger(n)) throw new Error("Invalid numeric field"); fields[key] = n;
    } else if (["totalMemoryMb","reservedMemoryMb","totalDiskGb","reservedDiskGb"].includes(key)) fields[key] = value;
  }
  if (!Object.keys(fields).length) throw new Error("No editable fields supplied");
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session unavailable");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/${entity}/${id}`, {
    method: "PATCH", headers: { Cookie: `kiiro_session=${cookie}`, "Content-Type": "application/json" },
    body: JSON.stringify(fields), cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload && typeof payload.message === "string" ? payload.message : `Update failed (HTTP ${response.status})`);
  }
  revalidatePath(`/admin/${entity}`);
  revalidatePath("/admin/dashboard");
}
