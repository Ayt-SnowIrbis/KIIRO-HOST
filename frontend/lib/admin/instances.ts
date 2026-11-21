import "server-only";
import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/config";

export type Instance = {
  id: string; name: string; status: string; kind: string; vcpu: number;
  memoryMb: number; diskGb: number; createdAt: string;
  provider: { name: string; slug: string };
  node: { name: string; status: string };
  region: { name: string; code: string };
  addresses: { address: string; family: string; isPrimary: boolean }[];
};

export type InstanceTask = {
  id: string; type: string; status: string; attempts: number;
  createdAt: string; startedAt: string | null; finishedAt: string | null; lastError: string | null;
};

async function token() {
  const value = (await cookies()).get("kiiro_session")?.value;
  if (!value || !/^[A-Za-z0-9_-]{32,256}$/.test(value)) throw new Error("Session unavailable");
  return value;
}

export async function getInstances(): Promise<Instance[]> {
  const response = await fetch(`${getApiBaseUrl()}/compute/instances`, {
    headers: { Cookie: `kiiro_session=${await token()}` }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`Instances HTTP ${response.status}`);
  return response.json();
}

export async function getInstanceTasks(id: string): Promise<InstanceTask[]> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid ID");
  const response = await fetch(`${getApiBaseUrl()}/compute/instances/${id}/tasks`, {
    headers: { Cookie: `kiiro_session=${await token()}` }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`Tasks HTTP ${response.status}`);
  return response.json();
}

export async function queueInstanceAction(id: string, action: "start" | "stop" | "reboot") {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid ID");
  const response = await fetch(`${getApiBaseUrl()}/compute/instances/${id}/${action}`, {
    method: "POST",
    headers: { Cookie: `kiiro_session=${await token()}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message = data && typeof data === "object" && "message" in data ? String(data.message) : "Request rejected";
    throw new Error(`Action failed: ${message.slice(0, 180)}`);
  }
  return response.json();
}
