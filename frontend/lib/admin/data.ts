import "server-only";
import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/config";

const endpoints = ["overview", "users", "instances", "nodes", "regions", "plans", "images", "tasks", "audit", "billing", "infrastructure/pools"] as const;
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

export type NodeConnectivity = { state: "REACHABLE" | "UNREACHABLE" | "NOT_CONFIGURED"; checkedAt: string };

export async function getNodeConnectivity(id: string): Promise<NodeConnectivity> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid node ID");
  const cookie = (await cookies()).get("kiiro_session")?.value;
  if (!cookie) throw new Error("Administrator session unavailable");
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/compute/admin/nodes/${encodeURIComponent(id)}/connectivity`, {
    headers: { Cookie: `kiiro_session=${cookie}` }, cache: "no-store", signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Connectivity request failed (HTTP ${response.status})`);
  return (await response.json()) as NodeConnectivity;
}
