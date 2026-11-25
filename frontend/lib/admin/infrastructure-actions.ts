"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "@/lib/config";

async function mutate(path: string, method: "POST" | "DELETE", payload?: object) {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session required");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/infrastructure/${path}`, {
    method, headers: { Cookie: `kiiro_session=${cookie}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}), cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.message === "string" ? body.message : `Infrastructure request failed: ${response.status}`);
  }
  revalidatePath("/admin/infrastructure");
  revalidatePath("/admin/nodes");
  revalidatePath("/admin/regions");
  revalidatePath("/admin/ipam");
}
async function changeNodeConnection(
  form: FormData,
  action: "connect" | "disconnect",
) {
  const id = String(form.get("id") ?? "");

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error("Invalid node");
  }

  await mutate(`nodes/${id}/${action}`, "POST");
}

export async function connectNode(form: FormData) {
  await changeNodeConnection(form, "connect");
}

export async function disconnectNode(form: FormData) {
  await changeNodeConnection(form, "disconnect");
}

export async function createNode(form: FormData) {
  await mutate("nodes", "POST", { name: String(form.get("name") ?? ""), providerId: String(form.get("providerId") ?? ""), regionId: String(form.get("regionId") ?? "") });
}
export async function removeNode(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid node");
  await mutate(`nodes/${id}`, "DELETE");
}
export async function createPool(form: FormData) {
  await mutate("pools", "POST", { regionId: String(form.get("regionId") ?? ""), nodeId: String(form.get("nodeId") ?? ""), cidr: String(form.get("cidr") ?? ""), gateway: String(form.get("gateway") ?? "") });
}
export async function addPoolAddress(form: FormData) {
  const id = String(form.get("poolId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid pool");
  await mutate(`pools/${id}/addresses`, "POST", { address: String(form.get("address") ?? "") });
}
export async function removePool(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid pool");
  await mutate(`pools/${id}`, "DELETE");
}


export type IpAddressFormState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function addPoolAddressSafe(
  _previous: IpAddressFormState,
  form: FormData,
): Promise<IpAddressFormState> {
  try {
    await addPoolAddress(form);
    return { status: "success", message: "IP address added successfully." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error
        ? error.message
        : "Unable to add IP address.",
    };
  }
}

export async function removePoolAddress(form: FormData) {
  const id = String(form.get("addressId") ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid address ID");
  await mutate(`addresses/${id}`, "DELETE");
}
