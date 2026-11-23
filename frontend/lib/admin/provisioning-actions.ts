"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "@/lib/config";

async function request(path: string, method: "POST" | "DELETE", payload?: Record<string, unknown>) {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session required");
  const response = await fetch(getApiBaseUrl().replace(/\\/$/, "") + "/compute/admin/provisioning/" + path, {
    method, headers: { Cookie: "kiiro_session=" + cookie, ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.message === "string" ? body.message : "Provisioning request failed: " + response.status);
  }
  revalidatePath("/admin/provisioning");
  revalidatePath("/admin/infrastructure");
  revalidatePath("/admin/instances");
}
export async function configureNodeProvisioning(form: FormData) {
  const id = String(form.get("nodeId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid node ID");
  await request("nodes/" + id + "/config", "POST", {
    network: String(form.get("network") ?? ""),
    storagePool: String(form.get("storagePool") ?? ""),
  });
}
export async function createIncusInstance(form: FormData) {
  await request("instances", "POST", {
    customerId: String(form.get("customerId") ?? ""),
    regionId: String(form.get("regionId") ?? ""),
    planId: String(form.get("planId") ?? ""),
    imageId: String(form.get("imageId") ?? ""),
    name: String(form.get("name") ?? ""),
  });
}
export async function deleteIncusInstance(form: FormData) {
  const id = String(form.get("instanceId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid instance ID");
  await request("instances/" + id, "DELETE");
}
