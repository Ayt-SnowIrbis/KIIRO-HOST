import { INSTANCE_ACTIONS, type Instance, type InstanceAction } from "./types";

function toLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatActionLabel(action: InstanceAction) {
  return action === "snapshots" ? "Snapshots" : toLabel(action);
}

export function getAvailableInstanceActions(instance: Instance) {
  return INSTANCE_ACTIONS.filter((action) => instance.capabilities[action]);
}

export function getUnavailableInstanceActions(instance: Instance) {
  return INSTANCE_ACTIONS.filter((action) => !instance.capabilities[action]);
}

export function formatStatusLabel(status: string) {
  return status
    .split("-")
    .map((part) => toLabel(part))
    .join(" ");
}
