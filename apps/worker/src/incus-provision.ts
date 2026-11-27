import { PrismaClient, Prisma } from "@prisma/client";
import { IncusClient } from "./incus-client";

const prisma = new PrismaClient();
const nodeId = process.env.INCUS_NODE_ID;
let busy = false;
let stopped = false;
type Job = { id: string; instance_id: string; type: "PROVISION" | "DELETE" | "RESIZE" | "CHANGE_PASSWORD" | "SSH_KEY_ADD" | "SSH_KEY_REMOVE"; payload: Prisma.JsonValue; external_id: string };
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
        AND t.type::text IN ('PROVISION', 'DELETE', 'RESIZE', 'CHANGE_PASSWORD', 'SSH_KEY_ADD', 'SSH_KEY_REMOVE')
        AND i.deleted_at IS NULL
        AND i.node_id = ${nodeId}
        AND i.external_id IS NOT NULL
        AND i.metadata->>'mode' = 'REAL'
        AND n.metadata->>'mode' = 'REAL'
        AND n.status = 'ONLINE'
        AND NOT EXISTS (SELECT 1 FROM tasks other WHERE other.instance_id = i.id AND other.status = 'RUNNING')
      ORDER BY t.created_at, t.id
      FOR UPDATE OF t, i SKIP LOCKED LIMIT 1
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
    await tx.task.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), ...(job.type === "PROVISION" ? {payload:{mode:"REAL"}} : {}) } });
  });
}
const SSH_FAILURE_CODES = new Set([
  "SSH_INVALID_PARAMETERS", "SSH_INSTANCE_NOT_RUNNING", "SSH_DNS_FAILED",
  "SSH_DNS_CONFIG_FAILED", "SSH_DNS_WAIT_FAILED",
  "SSH_APT_UPDATE_FAILED", "SSH_APT_INSTALL_FAILED", "SSH_SSHD_CONFIG_FAILED",
  "SSH_PASSWORD_APPLY_FAILED",
]);
function safeProvisionStage(stage: string, error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return stage === "SSH_SETUP" && SSH_FAILURE_CODES.has(code) ? code : stage;
}
async function fail(job: Job, error: unknown, provisionStage = "UNKNOWN"): Promise<void> {
  const message = job.type === "PROVISION" ? `Provisioning failed at ${safeProvisionStage(provisionStage, error)}; operator reconciliation required` : (error instanceof Error ? error.message : String(error)).slice(0, 4000);
  await prisma.$transaction(async tx => {
    const task = await tx.task.findUnique({ where: { id: job.id } });
    if (!task || task.status !== "RUNNING") return;
    await tx.task.update({ where: { id: job.id }, data: { status: "FAILED", lastError: ["CHANGE_PASSWORD","SSH_KEY_ADD","SSH_KEY_REMOVE"].includes(job.type) ? "SSH access operation failed; retry or reconcile" : message, finishedAt: new Date(), ...(["CHANGE_PASSWORD","PROVISION","SSH_KEY_ADD","SSH_KEY_REMOVE"].includes(job.type) ? {payload:{mode:"REAL"}} : {}) } });
    const instance = await tx.instance.findUniqueOrThrow({where:{id:job.instance_id}});
    if (!["CHANGE_PASSWORD","SSH_KEY_ADD","SSH_KEY_REMOVE"].includes(job.type)) await tx.instance.update({ where: { id: job.instance_id }, data: { status: "ERROR", ...(job.type === "RESIZE" ? {metadata:{...obj(instance.metadata),resizeUncertain:true} as Prisma.InputJsonValue} : {}) } });
    await tx.instanceEvent.create({ data: { instanceId: job.instance_id, eventType: "INCUS_TASK_FAILED", payload: { taskId: job.id, action: job.type, message: ["CHANGE_PASSWORD","SSH_KEY_ADD","SSH_KEY_REMOVE"].includes(job.type) ? "SSH access operation failed" : message } } });
  });
  // Intentionally keep the IP and resource reservation on failure.
  // A timed-out remote operation may have completed: never reassign its IP automatically.
}
async function processOne(client: IncusClient): Promise<void> {
  if (busy || stopped) return;
  busy = true;
  let job: Job | null = null;
  let provisionStage = "CLAIM";
  try {
    job = await claim();
    if (!job) return;
    if (!/^kh-[A-Za-z0-9_-]{1,128}$/.test(job.external_id)) throw new Error("Instance name is not owned by provisioning driver");
    if (job.type === "PROVISION") {
      const p = obj(job.payload);
      if (p.nodeId !== nodeId || p.externalName !== job.external_id || p.mode !== "REAL") throw new Error("Task identity mismatch");
      provisionStage = "CREATE";
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
      provisionStage = "START";
      await client.action(job.external_id, "start");
      provisionStage = "VERIFY_RUNNING";
      const state = await client.instance(job.external_id);
      if (state.name !== job.external_id || state.status !== "Running") throw new Error("Provisioned container is not running");
      provisionStage = "SSH_SETUP";
      if (p.passwordHash !== undefined) await client.setRootPasswordHash(job.external_id, text(p.passwordHash, "passwordHash"));
      provisionStage = "COMPLETE";
      await complete(job, "RUNNING");
    } else if (job.type === "CHANGE_PASSWORD") {
      const p = obj(job.payload);
      const i = await prisma.instance.findUniqueOrThrow({where:{id:job.instance_id}});
      if (p.mode !== "REAL" || obj(i.metadata).provisioning !== "INCUS" || i.nodeId !== nodeId || i.externalId !== job.external_id || i.status !== "RUNNING" || i.deletedAt) throw new Error("Password reset identity mismatch");
      await client.setRootPasswordHash(job.external_id,text(p.passwordHash,"passwordHash"));
      await prisma.$transaction(async tx=>{
        await tx.task.update({where:{id:job!.id},data:{status:"SUCCEEDED",finishedAt:new Date(),payload:{mode:"REAL"}}});
        await tx.instanceEvent.create({data:{instanceId:i.id,eventType:"INCUS_PASSWORD_CHANGED",payload:{taskId:job!.id}}});
      });
    } else if (job.type === "SSH_KEY_ADD" || job.type === "SSH_KEY_REMOVE") {
      const p = obj(job.payload);
      const i = await prisma.instance.findUniqueOrThrow({where:{id:job.instance_id}});
      if (p.mode !== "REAL" || obj(i.metadata).provisioning !== "INCUS" || i.nodeId !== nodeId ||
          i.externalId !== job.external_id || i.status !== "RUNNING" || i.deletedAt) throw new Error("SSH key task identity mismatch");
      const key = text(p.publicKey,"publicKey");
      await client.manageRootSshKey(job.external_id, key, job.type === "SSH_KEY_ADD" ? "add" : "remove");
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM instances WHERE id=${i.id} FOR UPDATE`;
        const current = await tx.instance.findUniqueOrThrow({where:{id:i.id}});
        const metadata = obj(current.metadata);
        const keys = Array.isArray(metadata.sshPublicKeys) ? metadata.sshPublicKeys.filter((v):v is string=>typeof v === "string") : [];
        const next = job!.type === "SSH_KEY_ADD" ? [...new Set([...keys,key])] : keys.filter(v=>v!==key);
        await tx.instance.update({where:{id:i.id},data:{metadata:{...metadata,sshPublicKeys:next} as Prisma.InputJsonValue}});
        await tx.task.update({where:{id:job!.id},data:{status:"SUCCEEDED",finishedAt:new Date(),payload:{mode:"REAL"}}});
        await tx.instanceEvent.create({data:{instanceId:i.id,eventType:"INCUS_SSH_KEY_UPDATED",payload:{taskId:job!.id,action:job!.type}}});
      });
    } else if (job.type === "RESIZE") {
      const p = obj(job.payload);
      const instance = await prisma.instance.findUniqueOrThrow({where:{id:job.instance_id}});
      const vcpu = number(p.vcpu,"vcpu"), memoryMb = number(p.memoryMb,"memoryMb"), diskGb = number(p.diskGb,"diskGb");
      if (p.mode !== "REAL" || obj(instance.metadata).provisioning !== "INCUS" || instance.status !== "STOPPED" || instance.externalId !== job.external_id || instance.nodeId !== nodeId || instance.vcpu !== p.oldVcpu || instance.memoryMb !== p.oldMemoryMb || instance.diskGb !== p.oldDiskGb || diskGb < instance.diskGb) throw new Error("Resize identity or resource mismatch");
      await client.resizeContainer(job.external_id,vcpu,memoryMb,diskGb);
      await prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM instances WHERE id=${instance.id} FOR UPDATE`;
        const task=await tx.task.findUniqueOrThrow({where:{id:job!.id}});
        if(task.status!=="RUNNING") throw new Error("Resize task no longer running");
        await tx.node.update({where:{id:instance.nodeId},data:{
          reservedVcpu:{decrement:Math.max(0,instance.vcpu-vcpu)},
          reservedMemoryMb:{decrement:BigInt(Math.max(0,instance.memoryMb-memoryMb))},
          reservedDiskGb:{decrement:BigInt(Math.max(0,instance.diskGb-diskGb))}
        }});
        await tx.instance.update({where:{id:instance.id},data:{vcpu,memoryMb,diskGb,status:"STOPPED",observedState:"STOPPED"}});
        await tx.instanceEvent.create({data:{instanceId:instance.id,eventType:"INCUS_RESIZED",payload:{taskId:job!.id,vcpu,memoryMb,diskGb}}});
        await tx.task.update({where:{id:job!.id},data:{status:"SUCCEEDED",finishedAt:new Date()}});
      });
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
    console.error(JSON.stringify({ event: "incus_provision_task_failed", taskId: job?.id, error: ["CHANGE_PASSWORD","PROVISION","SSH_KEY_ADD","SSH_KEY_REMOVE"].includes(job?.type ?? "") ? "Credential or provisioning operation failed" : String(error), ...(job?.type === "PROVISION" ? { stage: safeProvisionStage(provisionStage, error) } : {}) }));
    if (job) {
      try { await fail(job, error, provisionStage); }
      catch (finalError) { console.error(JSON.stringify({ event: "incus_provision_finalize_failed", error: ["CHANGE_PASSWORD","PROVISION","SSH_KEY_ADD","SSH_KEY_REMOVE"].includes(job.type) ? "Credential or provisioning finalization failed" : String(finalError) })); }
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
