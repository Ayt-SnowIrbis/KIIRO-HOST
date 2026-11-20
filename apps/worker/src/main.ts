import { Worker } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 5);

if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error("WORKER_CONCURRENCY must be a positive integer");
}

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const worker = new Worker(
  "kiiro-operations",
  async (job) => {
    // Fail closed until a real domain processor is registered.
    // BullMQ will mark unsupported work as failed instead of silently completing it.
    console.error(JSON.stringify({
      event: "job_rejected",
      jobId: job.id,
      name: job.name,
      reason: "No processor is registered in Foundation v1.1",
    }));
    throw new Error(`Unsupported job "${job.name}": no processor registered`);
  },
  { connection, concurrency },
);

worker.on("error", (error) =>
  console.error(JSON.stringify({ event: "worker_error", error: error.message })),
);
worker.on("failed", (job, error) =>
  console.error(JSON.stringify({ event: "job_failed", jobId: job?.id, error: error.message })),
);
worker.on("completed", (job) =>
  console.info(JSON.stringify({ event: "job_completed", jobId: job.id })),
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(JSON.stringify({ event: "worker_shutdown", signal }));
  await worker.close();
  await connection.quit();
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

console.info("KIIRO-HOST worker started; queue=kiiro-operations; unsupported jobs fail closed");
