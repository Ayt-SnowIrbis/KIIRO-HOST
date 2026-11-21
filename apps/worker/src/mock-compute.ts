import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let busy = false;
let stopping = false;

const supported = [
  "PROVISION",
  "START",
  "STOP",
  "REBOOT",
] as const;

async function processOne() {
  if (busy || stopping) return;
  busy = true;

  try {
    await prisma.$transaction(async (tx) => {
      // Claim only tasks belonging to explicitly simulated nodes.
      // FOR UPDATE SKIP LOCKED prevents concurrent workers from
      // processing the same task.
      const rows = await tx.$queryRaw<
        Array<{ id: string; instance_id: string; type: string }>
      >`
        SELECT t.id, t.instance_id, t.type::text
        FROM tasks t
        JOIN instances i ON i.id = t.instance_id
        JOIN nodes n ON n.id = i.node_id
        WHERE t.status = 'QUEUED'
          AND t.available_at <= NOW()
          AND t.type::text IN ('PROVISION','START','STOP','REBOOT')
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
        (type === "REBOOT" && instance.status === "RUNNING");

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
