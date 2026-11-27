import { createHmac, timingSafeEqual } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import WebSocket from "ws";
import { IncusClient } from "./incus-client";
import { incusResizeControl } from "./incus-console-protocol";

type Open = {
  sid: string; instanceId: string; nodeId: string;
  externalName: string; issuedAt: number; signature: string;
};
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SID_RE = /^[A-Za-z0-9_-]{32}$/;
const NAME_RE = /^kh-[a-z0-9-]{1,60}$/;
const CHANNEL = "kiiro:console:v1:";
const MAX_SESSIONS = 2;
export function verifyConsoleOpen(request: Open, nodeId: string, key: string): boolean {
  if (!request || !SID_RE.test(request.sid) || !ID_RE.test(request.instanceId) ||
      request.nodeId !== nodeId || !NAME_RE.test(request.externalName) ||
      !Number.isSafeInteger(request.issuedAt) || Math.abs(Date.now() - request.issuedAt) > 15000 ||
      typeof request.signature !== "string" || !/^[a-f0-9]{64}$/.test(request.signature)) return false;
  const payload = [request.sid, request.instanceId, request.nodeId,
    request.externalName, String(request.issuedAt)].join("|");
  const expected = createHmac("sha256", key).update(payload).digest();
  const supplied = Buffer.from(request.signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}
export function startIncusConsoleBroker(): void {
  if (process.env.CONSOLE_WORKER_ENABLED !== "true") return;
  const nodeId = process.env.INCUS_NODE_ID ?? "";
  const key = process.env.CONSOLE_BRIDGE_SECRET ?? "";
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(nodeId) || key.length < 48)
    throw new Error("Console broker configuration missing");

  const prisma = new PrismaClient();
  const subscriber = new Redis(process.env.REDIS_URL ?? "");
  const publisher = new Redis(process.env.REDIS_URL ?? "");
  const client = new IncusClient();
  const active = new Map<string, () => void>();
  const openChannel = CHANNEL + "open:" + nodeId;

  async function eligible(r: Open): Promise<boolean> {
    const instance = await prisma.instance.findFirst({
      where: { id: r.instanceId, nodeId, externalId: r.externalName, deletedAt: null },
      include: { node: true, provider: true },
    });
    if (!instance || instance.status !== "RUNNING" || instance.kind !== "CONTAINER" ||
        instance.provider.slug !== "INCUS" || instance.node.status !== "ONLINE" ||
        !instance.node.lastSeenAt ||
        Date.now() - instance.node.lastSeenAt.getTime() > 180000 ||
        instance.node.lastSeenAt.getTime() > Date.now()) return false;
    const metadata = instance.metadata;
    const nodeMeta = instance.node.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        metadata.mode !== "REAL" || metadata.provisioning !== "INCUS" ||
        !nodeMeta || typeof nodeMeta !== "object" || Array.isArray(nodeMeta) ||
        nodeMeta.mode !== "REAL") return false;
    const pending = await prisma.task.findFirst({
      where: { instanceId: instance.id, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    });
    return !pending;
  }
  const outgoing = (sid: string, frame: object): Promise<number> =>
    publisher.publish(CHANNEL + sid + ":events", JSON.stringify(frame));

  async function start(request: Open): Promise<void> {
    const { sid, externalName } = request;
    if (active.size >= MAX_SESSIONS || active.has(sid) || !(await eligible(request))) return;
    const inputRedis = new Redis(process.env.REDIS_URL ?? "");
    const inputChannel = CHANNEL + sid + ":commands";
    let terminal: WebSocket | undefined;
    let control: WebSocket | undefined;
    let operationPath: string | undefined;
    let closed = false;
    let lastActivity = Date.now();
    const close = async () => {
      if (closed) return;
      closed = true;
      active.delete(sid);
      clearInterval(checker);
      clearTimeout(timeout);
      terminal?.terminate();
      control?.terminate();
      await Promise.allSettled([
        operationPath ? client.terminateConsoleExec(operationPath) : Promise.resolve(),
        inputRedis.quit(),
      ]);
      await outgoing(sid, { type: "closed" }).catch(() => {});
    };
    const checker = setInterval(() => {
      if (Date.now() - lastActivity > 5 * 60_000) { void close(); return; }
      void eligible(request).then(ok => { if (!ok) void close(); }).catch(() => void close());
    }, 15000);
    checker.unref();
    const timeout = setTimeout(() => void close(), 30 * 60_000);
    timeout.unref();
    active.set(sid, () => void close());
    try {
      await inputRedis.subscribe(inputChannel);
      // Subscribed before notifying gateway: neither side loses early frames.
      inputRedis.on("message", (_channel, payload) => {
        if (closed || payload.length > 12000) return;
        let frame: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(payload);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
          frame = parsed as Record<string, unknown>;
        } catch { return; }
        if (frame.type === "close") { void close(); return; }
        if (!terminal || !control) return;
        if (frame.type === "input" && typeof frame.data === "string" &&
            frame.data.length <= 11000 && /^[A-Za-z0-9+/]*={0,2}$/.test(frame.data) &&
            terminal.readyState === WebSocket.OPEN) {
          const raw = Buffer.from(frame.data, "base64");
          if (raw.length > 8192 || terminal.bufferedAmount > 262144) { void close(); return; }
          lastActivity = Date.now();
          terminal.send(raw);
        } else if (frame.type === "resize" && Number.isInteger(frame.width) &&
                   Number.isInteger(frame.height) && control.readyState === WebSocket.OPEN) {
          try { control.send(incusResizeControl(Number(frame.width), Number(frame.height))); }
          catch { void close(); }
        }
      });
      if (!(await eligible(request)) || closed) throw new Error("Console eligibility changed");
      const streams = await client.prepareConsoleExec(externalName);
      operationPath = streams.operationPath;
      const sockets = await client.attachConsoleSockets(streams);
      terminal = sockets.terminal;
      control = sockets.control;
      for (const socket of [terminal, control]) {
        socket.on("close", () => void close());
        socket.on("error", () => void close());
      }
      terminal.on("message", (payload, isBinary) => {
        if (closed) return;
        const data = Buffer.isBuffer(payload) ? payload :
          Array.isArray(payload) ? Buffer.concat(payload) : Buffer.from(payload);
        if (data.length > 16384) { void close(); return; }
        lastActivity = Date.now();
        void outgoing(sid, { type: "output", data: data.toString("base64") });
      });
      await outgoing(sid, { type: "ready" });
    } catch {
      await outgoing(sid, { type: "error" }).catch(() => {});
      await close();
    }
  }
  void subscriber.subscribe(openChannel).then(() => {
    subscriber.on("message", (channel, message) => {
      if (channel !== openChannel || message.length > 2048) return;
      try {
        const req = JSON.parse(message) as Open;
        if (!verifyConsoleOpen(req, nodeId, key)) return;
        void start(req).catch(() => {});
      } catch { /* no untrusted payload logs */ }
    });
  });
  process.once("SIGTERM", () => {
    for (const stop of active.values()) stop();
    void subscriber.quit();
    void publisher.quit();
    void prisma.$disconnect();
  });
}
