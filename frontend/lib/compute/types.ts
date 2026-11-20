export const INSTANCE_ACTIONS = [
  "start",
  "stop",
  "reboot",
  "snapshots",
  "console",
  "resize",
  "reinstall",
] as const;

export type InstanceAction = (typeof INSTANCE_ACTIONS)[number];

export type ProviderSlug = "incus" | "proxmox" | (string & {});
export type InstanceKind = "vm" | "container";
export type InstanceStatus = "running" | "stopped" | "provisioning" | "error";
export type ProviderStatus = "active" | "planned" | "maintenance";
export type NodeStatus = "online" | "degraded" | "maintenance";
export type OperationTaskStatus = "queued" | "running" | "completed" | "failed";

export type CapabilityFlags = Record<InstanceAction, boolean>;

export interface Provider {
  id: string;
  slug: ProviderSlug;
  name: string;
  description: string;
  status: ProviderStatus;
  supportedInstanceKinds: InstanceKind[];
  capabilities: CapabilityFlags;
}

export interface Region {
  id: string;
  name: string;
  code: string;
  providerIds: string[];
}

export interface Node {
  id: string;
  name: string;
  providerId: string;
  regionId: string;
  status: NodeStatus;
}

export interface Image {
  id: string;
  providerId: string;
  name: string;
  version: string;
  osFamily: string;
  supportedInstanceKinds: InstanceKind[];
}

export interface Plan {
  id: string;
  name: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  supportedProviderIds: string[];
}

export interface OperationTask {
  id: string;
  instanceId: string;
  action: InstanceAction;
  status: OperationTaskStatus;
  startedAt: string;
}

export interface Instance {
  id: string;
  name: string;
  providerId: string;
  nodeId: string;
  regionId: string;
  imageId: string;
  planId: string;
  kind: InstanceKind;
  status: InstanceStatus;
  ipv4: string;
  capabilities: CapabilityFlags;
}
