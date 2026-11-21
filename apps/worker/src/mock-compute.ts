import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let busy = false;
let stopping = false;

const supported = [
  "PROVISION",
  "START",
  "STOP",
  "REBOOT",
  "RESIZE",
] as const;

type ResizeTarget = { vcpu: number; memoryMb: number; diskGb: number };
type ResizePayload = { target?: unknown; requestedBy?: string };
function taskPayload(value: unknown): ResizePayload {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ResizePayload : {};
}
function isResizeTarget(value: unknown, minimumDiskGb: number): value is ResizeTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return Number.isSafeInteger(target.vcpu) && Number(target.vcpu) >= 1 && Number(target.vcpu) <= 256
    && Number.isSafeInteger(target.memoryMb) && Number(target.memoryMb) >= 1 && Number(target.memoryMb) <= 1_048_576
    && Number.isSafeInteger(target.diskGb) && Number(target.diskGb) >= minimumDiskGb && Number(target.diskGb) <= 100_000;
}

async function processOne() {
  if (busy || stopping) return;
  busy = true;

  try {
    await prisma.$transaction(async (tx) => {
      // Claim only tasks belonging to explicitly simulated nodes.
      // FOR UPDATE SKIP LOCKED prevents concurrent workers from
      // processing the same task.
      const rows = await tx.$queryRaw<
        Array<{ id: string; instance_id: string; node_id: string; type: string }>
      >`
        SELECT t.id, t.instance_id, i.node_id, t.type::text
        FROM tasks t
        JOIN instances i ON i.id = t.instance_id
        JOIN nodes n ON n.id = i.node_id
        WHERE t.status = 'QUEUED'
          AND t.available_at <= NOW()
          AND t.type::text IN ('PROVISION','START','STOP','REBOOT','RESIZE')
          AND i.metadata->>'mode' = 'MOCK'
          AND n.metadata->>'mode' = 'MOCK'
          AND n.metadata->>'networkEnabled' = 'false'
          AND n.status = 'ONLINE'
          AND i.deleted_at IS NULL
        ORDER BY t.created_at
        FOR UPDATE OF t SKIP LOCKED
        LIMIT 1
      `;

      const task = rows[0];
      if (!task) return;

      const instance = await tx.instance.findUnique({
        where: { id: task.instance_id },
      });

      if (!instance) return;

      const type = task.type as typeof supported[number];

      const valid =
        (type === "PROVISION" && instance.status === "PENDING") ||
        (type === "START" && instance.status === "STOPPED") ||
        (type === "STOP" && instance.status === "RUNNING") ||
        (type === "REBOOT" && instance.status === "RUNNING") ||
        (type === "RESIZE" && (instance.status === "RUNNING" || instance.status === "STOPPED"));

      if (!valid) {
        await tx.task.update({
          where: { id: task.id },
          data: {
            status: "FAILED",
            attempts: { increment: 1 },
            finishedAt: new Date(),
            lastError: `Invalid state for ${type}: ${instance.status}`,
          },
        });
        return;
      }

      if (type === "RESIZE") {
        const payload = taskPayload(await tx.task.findUniqueOrThrow({ where: { id: task.id }, select: { payload: true } }).then((x) => x.payload));
        const target = payload.target;
        if (!isResizeTarget(target, instance.diskGb)) {
          await tx.task.update({ where: { id: task.id }, data: { status: "FAILED", attempts: { increment: 1 }, finishedAt: new Date(), lastError: "Invalid resize target" } });
          return;
        }
        // Serialize capacity checks for every resize on the same node.
        const nodeRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM nodes WHERE id = ${task.node_id} FOR UPDATE`;
        if (!nodeRows.length) {
          await tx.task.update({ where: { id: task.id }, data: { status: "FAILED", attempts: { increment: 1 }, finishedAt: new Date(), lastError: "Compute node not found" } });
          return;
        }
        const node = await tx.node.findUnique({ where: { id: task.node_id } });
        if (!node || node.status !== "ONLINE") {
          await tx.task.update({ where: { id: task.id }, data: { status: "FAILED", attempts: { increment: 1 }, finishedAt: new Date(), lastError: "Compute node is not online" } });
          return;
        }
        const usage = await tx.instance.aggregate({
          where: { nodeId: task.node_id, deletedAt: null, status: { not: "DELETED" }, id: { not: instance.id } },
          _sum: { vcpu: true, memoryMb: true, diskGb: true },
        });
        const reservedVcpuWithoutCurrent = Math.max(0, node.reservedVcpu - instance.vcpu);
        const reservedMemoryWithoutCurrent = node.reservedMemoryMb > BigInt(instance.memoryMb) ? node.reservedMemoryMb - BigInt(instance.memoryMb) : 0n;
        const reservedDiskWithoutCurrent = node.reservedDiskGb > BigInt(instance.diskGb) ? node.reservedDiskGb - BigInt(instance.diskGb) : 0n;
        const usedVcpuWithoutCurrent = Math.max(reservedVcpuWithoutCurrent, usage._sum.vcpu ?? 0);
        const usedMemoryWithoutCurrent = reservedMemoryWithoutCurrent > BigInt(usage._sum.memoryMb ?? 0) ? reservedMemoryWithoutCurrent : BigInt(usage._sum.memoryMb ?? 0);
        const usedDiskWithoutCurrent = reservedDiskWithoutCurrent > BigInt(usage._sum.diskGb ?? 0) ? reservedDiskWithoutCurrent : BigInt(usage._sum.diskGb ?? 0);
        const nextReservedVcpu = usedVcpuWithoutCurrent + target.vcpu;
        const nextReservedMemoryMb = usedMemoryWithoutCurrent + BigInt(target.memoryMb);
        const nextReservedDiskGb = usedDiskWithoutCurrent + BigInt(target.diskGb);
        const fits = nextReservedVcpu >= 0 && nextReservedVcpu <= node.totalVcpu
          && nextReservedMemoryMb >= 0n && nextReservedMemoryMb <= node.totalMemoryMb
          && nextReservedDiskGb >= 0n && nextReservedDiskGb <= node.totalDiskGb;
        if (!fits) {
          await tx.task.update({ where: { id: task.id }, data: { status: "FAILED", attempts: { increment: 1 }, finishedAt: new Date(), lastError: "Insufficient node capacity for requested resources" } });
          return;
        }
        await tx.task.update({ where: { id: task.id }, data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } } });
        const before = { vcpu: instance.vcpu, memoryMb: instance.memoryMb, diskGb: instance.diskGb };
        const after = { vcpu: target.vcpu, memoryMb: target.memoryMb, diskGb: target.diskGb };
        await tx.instance.update({ where: { id: instance.id }, data: {
          vcpu: target.vcpu, memoryMb: target.memoryMb, diskGb: target.diskGb,
          metadata: { ...(typeof instance.metadata === "object" && instance.metadata !== null && !Array.isArray(instance.metadata) ? instance.metadata : {}), mode: "MOCK", simulation: true, lastMockAction: "RESIZE", lastResizeAt: new Date().toISOString() },
        } });
        await tx.node.update({ where: { id: node.id }, data: { reservedVcpu: nextReservedVcpu, reservedMemoryMb: nextReservedMemoryMb, reservedDiskGb: nextReservedDiskGb } });
        await tx.instanceEvent.create({ data: { instanceId: instance.id, eventType: "INSTANCE_RESIZED", payload: { before, after, mode: "MOCK", taskId: task.id } } });
        const requestedBy = typeof payload.requestedBy === "string" ? payload.requestedBy : null;
        if (requestedBy) await tx.auditLog.create({ data: { userId: requestedBy, action: "INSTANCE_RESIZED", entityType: "INSTANCE", entityId: instance.id, metadata: { before, after, taskId: task.id, mode: "MOCK" } } });
        await tx.task.update({ where: { id: task.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), lastError: null } });
        console.info(JSON.stringify({ event: "mock_compute_resized", taskId: task.id, instanceId: instance.id, before, after }));
        return;
      }

      const nextStatus = type === "STOP" ? "STOPPED" : "RUNNING";

      await tx.task.update({
        where: { id: task.id },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          attempts: { increment: 1 },
        },
      });

      await tx.instance.update({
        where: { id: instance.id },
        data: {
          status: nextStatus,
          desiredState: nextStatus,
          observedState: nextStatus,
          metadata: {
            ...(typeof instance.metadata === "object" &&
            instance.metadata !== null &&
            !Array.isArray(instance.metadata)
              ? instance.metadata
              : {}),
            mode: "MOCK",
            simulation: true,
            lastMockAction: type,
          },
        },
      });

      await tx.task.update({
        where: { id: task.id },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          lastError: null,
        },
      });

      console.info(JSON.stringify({
        event: "mock_compute_completed",
        taskId: task.id,
        instanceId: instance.id,
        action: type,
        status: nextStatus,
      }));
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "mock_compute_error",
      error: error instanceof Error ? error.message : String(error),
    }));
  } finally {
    busy = false;
  }
}

export function startMockComputeProcessor() {
  if (process.env.MOCK_COMPUTE_ENABLED !== "true") {
    console.info("Mock compute processor disabled");
    return;
  }

  console.info("Mock compute processor enabled");

  const interval = setInterval(() => {
    void processOne();
  }, 3000);

  void processOne();

  const shutdown = () => {
    stopping = true;
    clearInterval(interval);
    // Do not disconnect Prisma while an operation is in flight.
    const wait = setInterval(() => {
      if (busy) return;
      clearInterval(wait);
      void prisma.$disconnect();
    }, 100);
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
