import { startIncusConsoleBroker } from "./incus-console-broker";
import { startIncusComputeProcessor } from "./incus-compute";
import { startIncusNodeMonitor } from "./incus-node-monitor";
import { startIncusProvisionProcessor } from "./incus-provision";

if (process.env.INCUS_COMPUTE_ENABLED !== "true") throw new Error("INCUS_COMPUTE_ENABLED=true is required");
if (process.env.MOCK_COMPUTE_ENABLED === "true") throw new Error("Mock compute must be disabled");
if (!process.env.INCUS_NODE_CONFIG_DIR) throw new Error("INCUS_NODE_CONFIG_DIR is required");
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(process.env.INCUS_NODE_ID ?? "")) throw new Error("Invalid INCUS_NODE_ID");

// The original incus-standalone.ts remains restricted to the existing test node.
// This separate entrypoint opts into per-node mTLS configuration.
startIncusComputeProcessor();
startIncusProvisionProcessor();
startIncusNodeMonitor();
startIncusConsoleBroker();
console.info(JSON.stringify({ event: "incus_managed_worker_started", nodeId: process.env.INCUS_NODE_ID }));
