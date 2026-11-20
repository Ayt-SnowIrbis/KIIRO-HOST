import type {
  CapabilityFlags,
  Image,
  Instance,
  Node,
  OperationTask,
  Plan,
  Provider,
  Region,
} from "./types";

function createCapabilities(overrides: Partial<CapabilityFlags> = {}): CapabilityFlags {
  return {
    start: true,
    stop: true,
    reboot: true,
    snapshots: false,
    console: false,
    resize: false,
    reinstall: false,
    ...overrides,
  };
}

export const providers: Provider[] = [
  {
    id: "provider-incus",
    slug: "incus",
    name: "Incus",
    description: "Container and VM provider exposed through the backend abstraction layer.",
    status: "active",
    supportedInstanceKinds: ["container", "vm"],
    capabilities: createCapabilities({
      snapshots: true,
      console: true,
      resize: true,
    }),
  },
  {
    id: "provider-proxmox",
    slug: "proxmox",
    name: "Proxmox",
    description: "Existing virtualization adapter shown as one provider among several.",
    status: "active",
    supportedInstanceKinds: ["vm", "container"],
    capabilities: createCapabilities({
      snapshots: true,
      console: true,
      reinstall: true,
    }),
  },
  {
    id: "provider-future",
    slug: "custom-adapter",
    name: "Future adapter",
    description: "Placeholder to show that more provider adapters can be added later.",
    status: "planned",
    supportedInstanceKinds: ["vm"],
    capabilities: createCapabilities(),
  },
];

export const regions: Region[] = [
  {
    id: "region-eu-west",
    name: "EU West",
    code: "eu-west",
    providerIds: ["provider-incus", "provider-proxmox"],
  },
  {
    id: "region-eu-central",
    name: "EU Central",
    code: "eu-central",
    providerIds: ["provider-incus"],
  },
];

export const nodes: Node[] = [
  {
    id: "node-incus-a",
    name: "incus-node-a",
    providerId: "provider-incus",
    regionId: "region-eu-west",
    status: "online",
  },
  {
    id: "node-incus-b",
    name: "incus-node-b",
    providerId: "provider-incus",
    regionId: "region-eu-central",
    status: "maintenance",
  },
  {
    id: "node-pve-a",
    name: "pve-cluster-a",
    providerId: "provider-proxmox",
    regionId: "region-eu-west",
    status: "degraded",
  },
];

export const images: Image[] = [
  {
    id: "image-ubuntu-2404",
    providerId: "provider-incus",
    name: "Ubuntu 24.04 LTS",
    version: "24.04",
    osFamily: "Ubuntu",
    supportedInstanceKinds: ["container", "vm"],
  },
  {
    id: "image-debian-12",
    providerId: "provider-proxmox",
    name: "Debian 12",
    version: "12",
    osFamily: "Debian",
    supportedInstanceKinds: ["vm"],
  },
];

export const plans: Plan[] = [
  {
    id: "plan-starter",
    name: "Starter Compute",
    vcpu: 2,
    memoryMb: 2048,
    diskGb: 40,
    supportedProviderIds: ["provider-incus", "provider-proxmox"],
  },
  {
    id: "plan-scale",
    name: "Scale Compute",
    vcpu: 4,
    memoryMb: 4096,
    diskGb: 80,
    supportedProviderIds: ["provider-incus"],
  },
];

export const instances: Instance[] = [
  {
    id: "inst-edge-web-01",
    name: "edge-web-01",
    providerId: "provider-incus",
    nodeId: "node-incus-a",
    regionId: "region-eu-west",
    imageId: "image-ubuntu-2404",
    planId: "plan-starter",
    kind: "container",
    status: "running",
    ipv4: "203.0.113.10",
    capabilities: createCapabilities({
      snapshots: true,
      console: true,
      resize: true,
    }),
  },
  {
    id: "inst-billing-api-01",
    name: "billing-api-01",
    providerId: "provider-proxmox",
    nodeId: "node-pve-a",
    regionId: "region-eu-west",
    imageId: "image-debian-12",
    planId: "plan-starter",
    kind: "vm",
    status: "stopped",
    ipv4: "203.0.113.25",
    capabilities: createCapabilities({
      snapshots: true,
      console: true,
      reinstall: true,
    }),
  },
  {
    id: "inst-ci-runner-01",
    name: "ci-runner-01",
    providerId: "provider-incus",
    nodeId: "node-incus-b",
    regionId: "region-eu-central",
    imageId: "image-ubuntu-2404",
    planId: "plan-scale",
    kind: "vm",
    status: "provisioning",
    ipv4: "198.51.100.48",
    capabilities: createCapabilities({
      stop: false,
      reboot: false,
      snapshots: true,
      console: true,
      resize: true,
    }),
  },
];

export const operationTasks: OperationTask[] = [
  {
    id: "task-inst-edge-web-01-snapshot",
    instanceId: "inst-edge-web-01",
    action: "snapshots",
    status: "completed",
    startedAt: "2026-09-16T10:15:00Z",
  },
  {
    id: "task-inst-billing-api-01-start",
    instanceId: "inst-billing-api-01",
    action: "start",
    status: "queued",
    startedAt: "2026-09-16T12:05:00Z",
  },
  {
    id: "task-inst-ci-runner-01-resize",
    instanceId: "inst-ci-runner-01",
    action: "resize",
    status: "running",
    startedAt: "2026-09-16T12:30:00Z",
  },
];
