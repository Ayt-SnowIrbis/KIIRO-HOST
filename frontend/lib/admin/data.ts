import "server-only";
import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/config";

const endpoints = ["overview", "users", "instances", "nodes", "regions", "plans", "images", "tasks", "audit", "billing"] as const;
export type AdminEndpoint = (typeof endpoints)[number];

export async function getAdminData<T>(endpoint: AdminEndpoint): Promise<T> {
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session unavailable");
  const path = endpoint === "instances" ? "compute/instances" : `compute/admin/${endpoint}`;
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/${path}`, {
    headers: { Cookie: `kiiro_session=${cookie}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Admin data request failed (HTTP ${response.status})`);
  return (await response.json()) as T;
}
