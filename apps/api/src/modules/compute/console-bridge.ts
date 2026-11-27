import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "redis";
import { WebSocket } from "ws";

type Target = { instanceId: string; nodeId: string; externalName: string };
export type ConsoleBridge = { receive: (value: unknown) => Promise<void>; close: () => Promise<void> };
const SESSION_RE = /^[A-Za-z0-9_-]{32}$/;
const MAX_INPUT = 8192;
function channel(id: string, suffix: string): string { return "kiiro:console:v1:" + id + ":" + suffix; }
function secret(): string {
  const value = process.env.CONSOLE_BRIDGE_SECRET ?? "";
  if (value.length < 48) throw new Error("Console bridge secret must be configured");
  return value;
}
export function signConsoleOpen(input: {
  sid: string; instanceId: string; nodeId: string; externalName: string; issuedAt: number;
}, key = secret()): string {
  const payload = [input.sid, input.instanceId, input.nodeId, input.externalName, String(input.issuedAt)].join("|");
  return createHmac("sha256", key).update(payload).digest("hex");
}
export async function connectConsoleBridge(
  ws: WebSocket, target: Target, onEnded: () => void, abort?: AbortSignal,
): Promise<ConsoleBridge> {
  if (process.env.CONSOLE_BRIDGE_ENABLED !== "true") throw new Error("Console bridge disabled");
  const sid = randomBytes(24).toString("base64url");
  if (!SESSION_RE.test(sid)) throw new Error("Invalid session id");
  const issuedAt = Date.now();
  const url = process.env.REDIS_URL;
  const subscriber = createClient({ url });
  const publisher = createClient({ url });
  // Redis emits socket errors even when individual commands are awaited.
  // Fail closed on transport loss without exposing connection details.
  subscriber.on("error", () => { rejectReady?.(new Error("Redis unavailable")); });
  publisher.on("error", () => { rejectReady?.(new Error("Redis unavailable")); });
  let closed = false, ready = false;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const active = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Can reject before async setup reaches `await active` (e.g. browser abort).
  void active.catch(() => {});
  const timer = setTimeout(() => rejectReady?.(new Error("Worker console startup timeout")), 12000);
  timer.unref();
  const events = channel(sid, "events");
  const commands = channel(sid, "commands");
  const onAbort = () => { rejectReady?.(new Error("Console closed")); void shutdown(); };
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    abort?.removeEventListener("abort", onAbort);
    try { if (publisher.isReady) await publisher.publish(commands, JSON.stringify({ type: "close" })); } catch { /* best effort */ }
    await Promise.allSettled([subscriber.quit(), publisher.quit()]);
    onEnded();
  };
  abort?.addEventListener("abort", onAbort, { once: true });
  try {
    if (abort?.aborted) throw new Error("Console already closed");
    await Promise.all([subscriber.connect(), publisher.connect()]);
    if (closed || abort?.aborted) throw new Error("Console closed during setup");
    await subscriber.subscribe(events, msg => {
      if (closed || msg.length > 22000) return;
      let data: unknown;
      try { data = JSON.parse(msg); } catch { return; }
      if (!data || typeof data !== "object" || Array.isArray(data)) return;
      const frame = data as Record<string, unknown>;
      if (frame.type === "ready") {
        ready = true; clearTimeout(timer); resolveReady?.(); return;
      }
      if (frame.type === "error" || frame.type === "closed") {
        rejectReady?.(new Error("Incus session unavailable"));
        void shutdown();
        return;
      }
      if (frame.type === "output" && ready && typeof frame.data === "string" &&
          frame.data.length <= 18000 && ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 262144) { void shutdown(); ws.close(1013, "Slow client"); return; }
        ws.send(JSON.stringify({ type: "output", data: frame.data }));
      }
    });
    if (closed || abort?.aborted) throw new Error("Console closed before startup");
    const request = { sid, instanceId: target.instanceId, nodeId: target.nodeId,
      externalName: target.externalName, issuedAt };
    await publisher.publish("kiiro:console:v1:open:" + target.nodeId,
      JSON.stringify({ ...request, signature: signConsoleOpen(request) }));
    await active;
    if (abort?.aborted || ws.readyState !== WebSocket.OPEN || closed) throw new Error("Console disconnected");
    ws.send(JSON.stringify({ type: "ready" }));
    return {
      receive: async value => {
        if (!ready || closed) return;
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid frame");
        const frame = value as Record<string, unknown>;
        if (frame.type === "input") {
          if (typeof frame.data !== "string" || frame.data.length > 11000 ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data) ||
              Buffer.from(frame.data, "base64").length > MAX_INPUT) throw new Error("Invalid input");
          await publisher.publish(commands, JSON.stringify({ type: "input", data: frame.data }));
        } else if (frame.type === "resize") {
          const { width, height } = frame;
          if (!Number.isInteger(width) || !Number.isInteger(height) ||
              Number(width) < 20 || Number(width) > 300 || Number(height) < 10 || Number(height) > 120)
            throw new Error("Invalid resize");
          await publisher.publish(commands, JSON.stringify({ type: "resize", width, height }));
        } else {
          throw new Error("Invalid console message");
        }
      },
      close: shutdown,
    };
  } catch (error) {
    await shutdown();
    throw error;
  }
}
