import { Worker } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const worker = new Worker(
  "kiiro-operations",
  async (job) => {
    // Foundation placeholder: domain processors (Incus provisioning, billing, mail) are added in later milestones.
    console.info(JSON.stringify({ event: "job_received", jobId: job.id, name: job.name }));
    return { accepted: true, processed: false, reason: "No domain processor registered in Foundation v1" };
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) },
);
worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "job_failed", jobId: job?.id, error: error.message })));
worker.on("completed", (job) => console.info(JSON.stringify({ event: "job_completed", jobId: job.id })));

async function shutdown() { await worker.close(); await connection.quit(); process.exit(0); }
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
console.info("KIIRO-HOST worker started; queue=kiiro-operations");
