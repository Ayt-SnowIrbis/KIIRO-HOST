import { PrismaClient, Prisma } from "@prisma/client";
import { IncusClient } from "./incus-client";

const prisma = new PrismaClient();
const nodeId = process.env.INCUS_NODE_ID;
let busy = false;
let stopped = false;
type Job = { id: string; instance_id: string; type: "PROVISION" | "DELETE"; payload: Prisma.JsonValue; external_id: string };
function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error("Missing " + name);
  return value;
}
function number(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("Invalid " + name);
  return Number(value);
}
async function claim(): Promise<Job | null> {
  if (!nodeId) return null;
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Job[]>`
      SELECT t.id, i.id AS instance_id, t.type::text, t.payload, i.external_id
      FROM tasks t
      JOIN instances i ON i.id = t.instance_id
      JOIN nodes n ON n.id = i.node_id
      WHERE t.status = 'QUEUED' AND t.available_at <= NOW()
        AND t.type::text IN ('PROVISION', 'DELETE')
        AND i.node_id = ${nodeId}
        AND i.external_id IS NOT NULL
        AND i.metadata->>'mode' = 'REAL'
        AND n.metadata->>'mode' = 'REAL'
        AND n.status = 'ONLINE'
        AND NOT EXISTS (SELECT 1 FROM tasks other WHERE other.instance_id = i.id AND other.status = 'RUNNING')
      ORDER BY t.created_at, t.id
      FOR UPDATE OF t SKIP LOCKED LIMIT 1
    `;
    const job = rows[0];
    if (!job) return null;
    await tx.task.update({
      where: { id: job.id },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    return job;
  });
}
async function complete(job: Job, status: "RUNNING" | "DELETED"): Promise<void> {
  await prisma.$transaction(async tx => {
    const task = await tx.task.findUnique({ where: { id: job.id } });
    if (!task || task.status !== "RUNNING") return;
    const instance = await tx.instance.findUnique({ where: { id: job.instance_id } });
    if (!instance) throw new Error("Instance record missing");
    if (status === "DELETED") {
      await tx.ipAddress.updateMany({ where: { instanceId: instance.id }, data: { status: "AVAILABLE", instanceId: null } });
      await tx.instanceAddress.deleteMany({ where: { instanceId: instance.id } });
      await tx.node.update({
        where: { id: instance.nodeId },
        data: {
          reservedVcpu: { decrement: instance.vcpu },
          reservedMemoryMb: { decrement: BigInt(instance.memoryMb) },
          reservedDiskGb: { decrement: BigInt(instance.diskGb) },
        },
      });
    }
    await tx.instance.update({
      where: { id: instance.id },
      data: {
        status, observedState: status === "DELETED" ? "DELETED" : "RUNNING",
        ...(status === "DELETED" ? { deletedAt: new Date() } : {}),
      },
    });
    await tx.instanceEvent.create({
      data: { instanceId: instance.id, eventType: "INCUS_" + (status === "DELETED" ? "DELETED" : "PROVISIONED"), payload: { taskId: job.id, nodeId } },
    });
    await tx.task.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
  });
}
async function fail(job: Job, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
  await prisma.$transaction(async tx => {
    const task = await tx.task.findUnique({ where: { id: job.id } });
    if (!task || task.status !== "RUNNING") return;
    await tx.task.update({ where: { id: job.id }, data: { status: "FAILED", lastError: message, finishedAt: new Date() } });
    await tx.instance.update({ where: { id: job.instance_id }, data: { status: "ERROR" } });
    await tx.instanceEvent.create({ data: { instanceId: job.instance_id, eventType: "INCUS_TASK_FAILED", payload: { taskId: job.id, action: job.type, message } } });
  });
  // Intentionally keep the IP and resource reservation on failure.
  // A timed-out remote operation may have completed: never reassign its IP automatically.
}
async function processOne(client: IncusClient): Promise<void> {
  if (busy || stopped) return;
  busy = true;
  let job: Job | null = null;
  try {
    job = await claim();
    if (!job) return;
    if (!/^kh-[A-Za-z0-9_-]{1,128}$/.test(job.external_id)) throw new Error("Instance name is not owned by provisioning driver");
    if (job.type === "PROVISION") {
      const p = obj(job.payload);
      if (p.nodeId !== nodeId || p.externalName !== job.external_id || p.mode !== "REAL") throw new Error("Task identity mismatch");
      await client.createContainer({
        name: job.external_id,
        imageAlias: text(p.imageAlias, "imageAlias"),
        network: text(p.network, "network"),
        storagePool: text(p.storagePool, "storagePool"),
        address: text(p.address, "address"),
        networkMode: p.networkMode === "routed" ? "routed" : "bridged",
        parent: p.networkMode === "routed" ? text(p.parent, "parent") : undefined,
        vcpu: number(p.vcpu, "vcpu"),
        memoryMb: number(p.memoryMb, "memoryMb"),
        diskGb: number(p.diskGb, "diskGb"),
      });
      await client.action(job.external_id, "start");
      const state = await client.instance(job.external_id);
      if (state.name !== job.external_id || state.status !== "Running") throw new Error("Provisioned container is not running");
      await complete(job, "RUNNING");
    } else {
      const instance = await prisma.instance.findUnique({ where: { id: job.instance_id } });
      if (!instance || obj(instance.metadata).provisioning !== "INCUS") throw new Error("Instance is not managed by provisioning driver");
      const remote = await client.instance(job.external_id);
      if (remote.name !== job.external_id || remote.type !== "container") throw new Error("Remote instance mismatch");
      if (remote.status === "Running") await client.action(job.external_id, "stop");
      await client.deleteContainer(job.external_id);
      await complete(job, "DELETED");
    }
    console.info(JSON.stringify({ event: "incus_provision_task_succeeded", taskId: job.id, type: job.type, nodeId }));
  } catch (error) {
    console.error(JSON.stringify({ event: "incus_provision_task_failed", taskId: job?.id, error: String(error) }));
    if (job) {
      try { await fail(job, error); }
      catch (finalError) { console.error(JSON.stringify({ event: "incus_provision_finalize_failed", error: String(finalError) })); }
    }
  } finally { busy = false; }
}
export function startIncusProvisionProcessor(): void {
  if (process.env.INCUS_COMPUTE_ENABLED !== "true") return;
  if (!nodeId) throw new Error("INCUS_NODE_ID required");
  const client = new IncusClient();
  const timer = setInterval(() => void processOne(client), 3000);
  void processOne(client);
  const shutdown = () => {
    stopped = true; clearInterval(timer);
    const wait = setInterval(() => {
      if (busy) return;
      clearInterval(wait);
      void prisma.$disconnect();
    }, 100);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
