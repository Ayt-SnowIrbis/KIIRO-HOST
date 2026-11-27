/**
 * Incus interactive exec protocol validation.
 *
 * This module runs only in the trusted per-node worker. The fds secrets are
 * never sent to the KIIRO frontend, the public API, logs or task payloads.
 */
export type ConsoleStreams = Readonly<{
  operationPath: string;
  terminalSecret: string;
  controlSecret: string;
}>;
const OPERATION_RE = /^\/1\.0\/operations\/[0-9a-fA-F-]{36}$/;
const SECRET_RE = /^[a-fA-F0-9]{32,128}$/;
const INSTANCE_RE = /^kh-[a-z0-9-]{1,60}$/;

export function assertManagedConsoleName(name: string): void {
  if (!INSTANCE_RE.test(name)) throw new Error("Invalid managed console target");
}
export function parseConsoleStreams(operation: unknown, metadata: unknown): ConsoleStreams {
  if (typeof operation !== "string") throw new Error("Missing Incus console operation");
  // Forbid absolute URLs and all redirections. A worker always uses its pinned
  // Incus origin and only permits a local operation path.
  if (!OPERATION_RE.test(operation)) throw new Error("Invalid Incus console operation path");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Invalid Incus operation metadata");
  }
  const outer = metadata as Record<string, unknown>;
  const detail = outer.metadata;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    throw new Error("Invalid Incus exec metadata");
  }
  const fds = (detail as Record<string, unknown>).fds;
  if (!fds || typeof fds !== "object" || Array.isArray(fds)) {
    throw new Error("Missing Incus websocket channels");
  }
  const channels = fds as Record<string, unknown>;
  if (typeof channels["0"] !== "string" || !SECRET_RE.test(channels["0"]) ||
      typeof channels.control !== "string" || !SECRET_RE.test(channels.control)) {
    throw new Error("Invalid Incus websocket secrets");
  }
  return {
    operationPath: operation,
    terminalSecret: channels["0"],
    controlSecret: channels.control,
  };
}

export function consoleDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || width < 20 || width > 300 ||
      !Number.isSafeInteger(height) || height < 10 || height > 120) {
    throw new Error("Invalid console dimensions");
  }
  return { width, height };
}
export function incusResizeControl(width: number, height: number): string {
  const dims = consoleDimensions(width, height);
  // The Incus control websocket expects string-valued arguments.
  return JSON.stringify({
    command: "window-resize",
    args: { width: String(dims.width), height: String(dims.height) },
  });
}
