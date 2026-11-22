import { PrismaClient, Prisma } from "@prisma/client";
import { IncusClient } from "./incus-client";

const prisma = new PrismaClient();
const nodeId = process.env.INCUS_NODE_ID;
const intervalMs = 60_000;
let running = false;
let stopped = false;

function object(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...value } as Record<string, Prisma.JsonValue> : {};
}
async function sample(client: IncusClient): Promise<void> {
  if (running || stopped || !nodeId) return;
  running = true;
  try {
    const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { metadata: true, provider: { select: { slug: true } } } });
    if (!node || node.provider.slug !== "INCUS") throw new Error("Node is not a registered Incus node");
    const inventory = await client.inventory();
    const checkedAt = new Date();
    await prisma.$transaction(async tx => {
      const current = await tx.node.findUnique({ where: { id: nodeId }, select: { metadata: true } });
      if (!current) return;
      await tx.node.update({
        where: { id: nodeId },
        data: {
          lastSeenAt: checkedAt,
          metadata: {
            ...object(current.metadata),
            inventory: {
              state: "REACHABLE", checkedAt: checkedAt.toISOString(),
              serverName: inventory.serverName, networks: inventory.networks,
              storagePools: inventory.storagePools, cpuThreads: inventory.cpuThreads,
              memoryBytes: inventory.memoryBytes,
            },
          },
        },
      });
    });
    console.info(JSON.stringify({ event: "incus_monitor_ok", nodeId, checkedAt: checkedAt.toISOString() }));
  } catch (error) {
    // Do not automatically mark OFFLINE: transient API failures must not affect scheduling.
    console.error(JSON.stringify({ event: "incus_monitor_failed", nodeId, error: String(error) }));
  } finally {
    running = false;
  }
}
export function startIncusNodeMonitor(): void {
  if (process.env.INCUS_MONITOR_ENABLED !== "true") return;
  if (!nodeId) throw new Error("INCUS_NODE_ID required for monitor");
  const client = new IncusClient();
  const timer = setInterval(() => void sample(client), intervalMs);
  void sample(client);
  const shutdown = () => { stopped = true; clearInterval(timer); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
