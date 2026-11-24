"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "@/lib/config";
import { requireAdminSession } from "@/lib/auth/server-session";

async function request(path: string, body: Record<string, unknown>) {
  await requireAdminSession();
  const token = (await cookies()).get("kiiro_session")?.value;
  if (!token) throw new Error("Administrator session required");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/plans${path}`, {
    method: "POST", headers: { Cookie: `kiiro_session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(typeof result?.message === "string" ? result.message : `Plan API HTTP ${response.status}`);
  }
  revalidatePath("/admin/plans");
  revalidatePath("/admin/instances");
  return response.json();
}

export async function createCatalogPlan(form: FormData) {
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const regionId = String(form.get("regionId") ?? "").trim();
  const vcpu = Number(form.get("vcpu"));
  const memoryMb = Number(form.get("memoryMb"));
  const diskGb = Number(form.get("diskGb"));
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug) || !name || !regionId ||
      ![vcpu,memoryMb,diskGb].every(n=>Number.isSafeInteger(n)&&n>0)) throw new Error("Invalid plan data");
  await request("", { slug, name, regionId, vcpu, memoryMb, diskGb });
}

export async function addCatalogPlanPrice(form: FormData) {
  const id = String(form.get("planId") ?? "");
  const billingModel = String(form.get("billingModel") ?? "");
  const currency = String(form.get("currency") ?? "").trim().toUpperCase();
  const interval = String(form.get("interval") ?? "");
  const amount = String(form.get("amount") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !["PREPAID","SUBSCRIPTION"].includes(billingModel) ||
      !/^[A-Z]{3}$/.test(currency) || !["hour","day","month","year"].includes(interval) ||
      !/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,2})?$/.test(amount)) throw new Error("Invalid price data");
  const [whole, fractional = ""] = amount.split(".");
  const amountMinor = (BigInt(whole)*100n+BigInt(fractional.padEnd(2,"0"))).toString();
  if (amountMinor === "0") throw new Error("Price must be positive");
  await request(`/${encodeURIComponent(id)}/prices`, { billingModel, currency, interval, amountMinor });
}
