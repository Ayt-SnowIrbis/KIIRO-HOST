import { startIncusComputeProcessor } from "./incus-compute";

if (process.env.INCUS_COMPUTE_ENABLED !== "true") {
  throw new Error("Standalone Incus worker requires INCUS_COMPUTE_ENABLED=true");
}
if (process.env.MOCK_COMPUTE_ENABLED === "true") {
  throw new Error("Standalone Incus worker must not enable mock compute");
}
if (process.env.INCUS_NODE_ID !== "incus-test-node-01") {
  throw new Error("Standalone test worker is restricted to incus-test-node-01");
}

startIncusComputeProcessor();
console.info(JSON.stringify({ event: "incus_standalone_started", nodeId: process.env.INCUS_NODE_ID }));
