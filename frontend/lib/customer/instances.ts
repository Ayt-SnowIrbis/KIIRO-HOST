import "server-only";
import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/config";

export type CustomerInstance = {
  id: string; name: string; kind: string; status: string; mode: "mock" | "real";
  vcpu: number; memoryMb: number; diskGb: number; createdAt: string; hasActiveTask?: boolean;
  provider: { name: string; slug: string };
  node: { name: string; status: string };
  region: { name: string; code: string };
  addresses: { family: string; address: string; isPrimary: boolean }[];
  image?: { name: string; version: string; osFamily: string };
};
export type CustomerTask = {
  id: string; type: string; status: string; attempts: number;
  lastError: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
};
export type CustomerEvent = { id: string; eventType: string; payload: unknown; createdAt: string };

async function sessionCookie() {
  const token = (await cookies()).get("kiiro_session")?.value;
  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error("Session unavailable");
  return `kiiro_session=${token}`;
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", await sessionCookie());
  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}${path}`, {
    ...init, headers, cache: "no-store",
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message = data && typeof data === "object" && "message" in data ? String(data.message) : "Request rejected";
    throw new Error(message.slice(0, 180));
  }
  return response.json() as Promise<T>;
}
function validId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid instance ID");
}
export function getCustomerInstances() {
  return request<CustomerInstance[]>("/compute/customer/instances");
}
export async function getCustomerInstance(id: string) {
  validId(id);
  return request<CustomerInstance>(`/compute/customer/instances/${id}`);
}
export async function getCustomerInstanceTasks(id: string) {
  validId(id);
  return request<CustomerTask[]>(`/compute/customer/instances/${id}/tasks`);
}
export async function getCustomerInstanceEvents(id: string) {
  validId(id);
  return request<CustomerEvent[]>(`/compute/customer/instances/${id}/events`);
}
export async function queueCustomerInstanceAction(id: string, action: "start" | "stop" | "reboot") {
  validId(id);
  return request<{ accepted: boolean; task: { id: string; status: string } }>(
    `/compute/customer/instances/${id}/${action}`, { method: "POST" },
  );
}
