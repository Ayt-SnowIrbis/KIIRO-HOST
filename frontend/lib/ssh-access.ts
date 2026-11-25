"use server";
import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/config";
import { requireAdminSession, requireUserSession } from "@/lib/auth/server-session";

export async function resetRootPassword(id: string, admin: boolean): Promise<{password?: string; error?: string}> {
  try {
    if (admin) await requireAdminSession(); else await requireUserSession();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error();
    const token = (await cookies()).get("kiiro_session")?.value;
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error();
    const path = admin ? "compute/instances" : "compute/customer/instances";
    const response = await fetch(`${getApiBaseUrl()}/${path}/${id}/password`, {
      method: "POST", headers: { Cookie: `kiiro_session=${token}` }, cache: "no-store",
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (typeof data.password !== "string" || !data.accepted) throw new Error();
    return {password: data.password};
  } catch { return {error: "Reset not confirmed. Check task history before retrying."}; }
}
