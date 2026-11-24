"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/server-session";
import { getApiBaseUrl } from "@/lib/config";

export async function createIncusCatalogImage(form: FormData) {
  await requireAdminSession();
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const version = String(form.get("version") ?? "").trim();
  const osFamily = String(form.get("osFamily") ?? "").trim();
  const incusAlias = String(form.get("incusAlias") ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug) || !name || !version || !osFamily ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(incusAlias)) throw new Error("Invalid image catalog fields");
  const token = (await cookies()).get("kiiro_session")?.value;
  if (!token) throw new Error("Administrator session required");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/image-catalog`, {
    method: "POST", headers: { Cookie: `kiiro_session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ slug, name, version, osFamily, incusAlias }), cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Image catalog creation failed (HTTP ${response.status})`);
  revalidatePath("/admin/images");
  revalidatePath("/admin/instances");
}
