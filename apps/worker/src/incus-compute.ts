import { PrismaClient, Prisma } from "@prisma/client";
import { IncusClient, type IncusAction } from "./incus-client";

const prisma = new PrismaClient();
const intervalMs = 3000;
const recoveryAgeMinutes = 10;
const nodeId = process.env.INCUS_NODE_ID;
const validName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
let busy = false;
let stopping = false;

type Claim = { id: string; instance_id: string; external_id: string; type: "START" | "STOP" | "REBOOT" };
type InstanceState = "RUNNING" | "STOPPED";
function metadata(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...value } as Record<string, Prisma.JsonValue> : {};
}
function observed(status: string): InstanceState | null {
  if (status === "Running") return "RUNNING";
  if (status === "Stopped") return "STOPPED";
  return null;
}
function desired(type: Claim["type"]): InstanceState {
  return type === "STOP" ? "STOPPED" : "RUNNING";
}
async function claimOne(): Promise<Claim | null> {
  if (!nodeId) return null;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Claim[]>`
      SELECT t.id, i.id AS instance_id, i.external_id, t.type::text
      FROM tasks t
      JOIN instances i ON i.id = t.instance_id
      JOIN nodes n ON n.id = i.node_id
      WHERE t.status = 'QUEUED'
        AND t.available_at <= NOW()
        AND t.type::text IN ('START','STOP','REBOOT')
        AND i.node_id = ${nodeId}
        AND i.external_id IS NOT NULL
        AND i.metadata->>'mode' = 'REAL'
        AND n.metadata->>'mode' = 'REAL'
        AND n.status = 'ONLINE'
        AND i.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM tasks other
          WHERE other.instance_id = i.id AND other.status = 'RUNNING'
        )
      ORDER BY t.created_at, t.id
      FOR UPDATE OF t, i SKIP LOCKED
      LIMIT 1
    `;
    const task = rows[0];
    if (!task) return null;
    // Keep the claim transaction short; never make network calls inside it.
    await tx.task.update({
      where: { id: task.id },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    return task;
  });
}
async function finish(task: Claim, state: InstanceState | null, error?: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.task.findUnique({ where: { id: task.id } });
    if (!current || current.status !== "RUNNING") return;
    if (error || !state) {
      await tx.task.update({
        where: { id: task.id },
        data: { status: "FAILED", finishedAt: new Date(), lastError: (error ?? "Unrecognized Incus state").slice(0, 4000) },
      });
      return;
    }
    const instance = await tx.instance.findUnique({ where: { id: task.instance_id } });
    if (!instance) throw new Error("Instance disappeared while finalizing task");
    await tx.instance.update({
      where: { id: instance.id },
      data: {
        status: state, observedState: state,
        // A queued request already records the requested desired state; keep it.
        metadata: { ...metadata(instance.metadata), mode: "REAL", lastIncusAction: task.type, lastIncusSyncAt: new Date().toISOString() },
      },
    });
    await tx.instanceEvent.create({
      data: { instanceId: instance.id, eventType: "INCUS_STATE_CHANGED", payload: { taskId: task.id, action: task.type, state } },
    });
    await tx.task.update({ where: { id: task.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), lastError: null } });
  });
}
async function processOne(client: IncusClient): Promise<void> {
  if (busy || stopping) return;
  busy = true;
  let task: Claim | null = null;
  try {
    task = await claimOne();
    if (!task) return;
    if (!validName.test(task.external_id)) throw new Error("Invalid Incus external instance name");
    const before = await client.instance(task.external_id);
    if (before.name !== task.external_id || before.type !== "container") throw new Error("Incus instance identity/type mismatch");
    const current = observed(before.status);
    const target = desired(task.type);
    if (!current) throw new Error(`Unsupported Incus state: ${before.status}`);
    // Idempotent START/STOP. REBOOT requires a running container.
    if (task.type === "REBOOT" && current !== "RUNNING") throw new Error("Cannot reboot a stopped container");
    if (current !== target || task.type === "REBOOT") {
      const action: IncusAction = task.type === "START" ? "start" : task.type === "STOP" ? "stop" : "restart";
      await client.action(task.external_id, action);
    }
    const after = await client.instance(task.external_id);
    const actual = observed(after.status);
    if (actual !== target) throw new Error(`Incus state mismatch: expected ${target}, got ${after.status}`);
    await finish(task, actual);
    console.info(JSON.stringify({ event: "incus_task_succeeded", taskId: task.id, instanceId: task.instance_id, state: actual }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "incus_task_failed", taskId: task?.id, error: message }));
    // An Incus timeout may mean the remote operation actually succeeded.
    // Re-read the observed state, but never replay a potentially executed REBOOT.
    if (task) {
      try {
        const remote = await client.instance(task.external_id);
        const state = observed(remote.status);
        if (state) {
          await prisma.instance.update({
            where: { id: task.instance_id },
            data: { observedState: state },
          });
          console.info(JSON.stringify({ event: "incus_error_observation", taskId: task.id, observedState: state }));
        }
      } catch (observeError) {
        console.error(JSON.stringify({ event: "incus_error_observation_failed", taskId: task.id, error: String(observeError) }));
      }
      try { await finish(task, null, message); }
      catch (finalizeError) { console.error(JSON.stringify({ event: "incus_finalize_failed", error: String(finalizeError) })); }
    }
  } finally {
    busy = false;
  }
}
// A stale RUNNING task may have executed remotely before the worker crashed.
// Never requeue it automatically. Record the observed state for operator review.
export async function reconcileStaleIncusTasks(client: IncusClient): Promise<number> {
  if (!nodeId) return 0;
  const stale = await prisma.task.findMany({
    where: {
      status: "RUNNING",
      type: { in: ["START", "STOP", "REBOOT"] },
      startedAt: { lt: new Date(Date.now() - recoveryAgeMinutes * 60_000) },
      instance: {
        nodeId,
        deletedAt: null,
        metadata: { path: ["mode"], equals: "REAL" },
      },
    },
    include: { instance: true },
    take: 20,
    orderBy: { startedAt: "asc" },
  });
  let reconciled = 0;
  for (const task of stale) {
    const instance = task.instance;
    if (!instance?.externalId || !validName.test(instance.externalId)) continue;
    // This recovery path is opt-in and should only run when all workers for this
    // node are stopped; otherwise a slow but live operation could be misclassified.
    let state: InstanceState | null = null;
    try {
      const remote = await client.instance(instance.externalId);
      if (remote.name !== instance.externalId || remote.type !== "container") continue;
      state = observed(remote.status);
    } catch (error) {
      console.error(JSON.stringify({ event: "incus_recovery_observation_failed", taskId: task.id, error: String(error) }));
      continue;
    }
    if (!state) continue;
    await prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: task.id, status: "RUNNING", startedAt: task.startedAt },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          lastError: `Worker interrupted; observed Incus state ${state}. Manual review required; do not replay automatically.`,
        },
      });
      if (result.count !== 1) return;
      await tx.instance.update({ where: { id: instance.id }, data: { observedState: state! } });
      await tx.instanceEvent.create({
        data: { instanceId: instance.id, eventType: "INCUS_TASK_RECOVERY_REVIEW", payload: { taskId: task.id, action: task.type, observedState: state! } },
      });
      reconciled++;
    });
  }
  return reconciled;
}

export function startIncusComputeProcessor(): void {
  if (process.env.INCUS_COMPUTE_ENABLED !== "true") {
    console.info("Incus compute processor disabled");
    return;
  }
  if (!nodeId || !nodeId.trim()) throw new Error("INCUS_NODE_ID is required when Incus compute is enabled");
  const client = new IncusClient();
  if (process.env.INCUS_RECOVER_STALE_TASKS === "true") {
    // Recovery is a separate one-shot operator procedure, never a live worker mode.
    throw new Error("Use incus-recover.ts for offline stale-task reconciliation");
  }
  console.info(JSON.stringify({ event: "incus_compute_enabled", nodeId }));
  const timer = setInterval(() => void processOne(client), intervalMs);
  void processOne(client);
  const shutdown = () => {
    stopping = true;
    clearInterval(timer);
    const wait = setInterval(() => {
      if (busy) return;
      clearInterval(wait);
      void prisma.$disconnect();
    }, 100);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
