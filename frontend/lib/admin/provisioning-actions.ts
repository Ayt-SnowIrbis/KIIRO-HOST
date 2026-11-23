"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "@/lib/config";

async function request(path: string, method: "POST" | "DELETE", payload?: Record<string, unknown>) {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session required");
  const response = await fetch(getApiBaseUrl().replace(new RegExp("/$"), "") + "/compute/admin/provisioning/" + path, {
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

export async function bindPoolToNode(form: FormData) {
  const poolId = String(form.get("poolId") ?? "");
  const nodeId = String(form.get("nodeId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(poolId) || !/^[A-Za-z0-9_-]{1,128}$/.test(nodeId)) throw new Error("Invalid pool or node ID");
  await request("pools/" + poolId + "/bind", "POST", { nodeId });
}

export async function createInfrastructureRegion(form: FormData) {
  await request("regions", "POST", {
    code: String(form.get("code") ?? ""),
    name: String(form.get("name") ?? ""),
    country: String(form.get("country") ?? ""),
  });
}
export async function moveNodeToRegion(form: FormData) {
  const id = String(form.get("nodeId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid node ID");
  await request("nodes/" + id + "/region", "POST", { regionId: String(form.get("regionId") ?? "") });
}

export async function configureIncusImageAlias(form: FormData) {
  const id = String(form.get("imageId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid image ID");
  await request("images/" + id + "/incus-alias", "POST", { alias: String(form.get("alias") ?? "") });
}
