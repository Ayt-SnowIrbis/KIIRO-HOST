/** Shared server-side eligibility for Incus browser console sessions.
 * This function is deliberately deny-by-default; it does not create an exec.
 * Callers MUST authenticate and authorize the actor before invoking it.
 */
export type ConsoleInstance = {
  kind: string;
  status: string;
  deletedAt: Date | null;
  externalId: string | null;
  metadata: unknown;
  provider: { slug: string };
  node: { status: string; lastSeenAt: Date | null; metadata: unknown };
};
export type ConsoleAvailability = {
  available: boolean;
  reason: "AVAILABLE" | "UNAVAILABLE";
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function consoleAvailability(instance: ConsoleInstance, hasActiveTask: boolean, now = Date.now()): ConsoleAvailability {
  const meta = object(instance.metadata);
  const nodeMeta = object(instance.node.metadata);
  const live = instance.node.lastSeenAt !== null &&
    instance.node.lastSeenAt.getTime() <= now &&
    now - instance.node.lastSeenAt.getTime() <= 180_000;
  const eligible = !instance.deletedAt &&
    instance.kind === "CONTAINER" &&
    instance.status === "RUNNING" &&
    instance.provider.slug === "INCUS" &&
    instance.node.status === "ONLINE" &&
    nodeMeta.mode === "REAL" &&
    live &&
    meta.mode === "REAL" &&
    meta.provisioning === "INCUS" &&
    typeof instance.externalId === "string" &&
    /^kh-[a-z0-9-]{1,60}$/.test(instance.externalId) &&
    !hasActiveTask;
  return { available: eligible, reason: eligible ? "AVAILABLE" : "UNAVAILABLE" };
}
