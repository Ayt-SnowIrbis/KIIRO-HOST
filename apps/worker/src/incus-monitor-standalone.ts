import { startIncusNodeMonitor } from "./incus-node-monitor";

if (process.env.INCUS_MONITOR_ENABLED !== "true") {
  throw new Error("INCUS_MONITOR_ENABLED=true is required");
}

if (process.env.INCUS_COMPUTE_ENABLED === "true") {
  throw new Error("Monitor must not run compute processor");
}

if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(process.env.INCUS_NODE_ID ?? "")) {
  throw new Error("Invalid INCUS_NODE_ID");
}

startIncusNodeMonitor();

console.info(JSON.stringify({
  event: "incus_monitor_standalone_started",
  nodeId: process.env.INCUS_NODE_ID
}));
