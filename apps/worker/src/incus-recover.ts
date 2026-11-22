import { IncusClient } from "./incus-client";
import { reconcileStaleIncusTasks } from "./incus-compute";

async function main(): Promise<void> {
  if (process.env.INCUS_RECOVER_STALE_TASKS !== "true") {
    throw new Error("Set INCUS_RECOVER_STALE_TASKS=true to run recovery explicitly");
  }
  if (process.env.INCUS_COMPUTE_ENABLED === "true") {
    throw new Error("Disable INCUS_COMPUTE_ENABLED during offline recovery");
  }
  if (!process.env.INCUS_NODE_ID) throw new Error("INCUS_NODE_ID is required");
  console.info(JSON.stringify({ event: "incus_recovery_started", nodeId: process.env.INCUS_NODE_ID }));
  const count = await reconcileStaleIncusTasks(new IncusClient());
  console.info(JSON.stringify({ event: "incus_recovery_complete", reviewed: count }));
}
void main().then(() => process.exit(0)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
