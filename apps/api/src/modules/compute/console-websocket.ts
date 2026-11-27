import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { PrismaService } from "../database/prisma.module";
import type { SessionService } from "../auth/services/session.service";
import { authorizeConsoleGateway } from "./console-authorization";
import { connectConsoleBridge, type ConsoleBridge } from "./console-bridge";

const PATH = "/api/console/ws";
const AUTH_TIMEOUT_MS = 5000;
const MAX_AUTH_FRAME = 512;
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  const options = (process.env.CONSOLE_ALLOWED_ORIGINS ?? "").split(",")
    .map(x => x.trim()).filter(x => /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(x));
  return options.includes(origin);
}
function cookieToken(request: IncomingMessage): string | null {
  const cookie = request.headers.cookie ?? "";
  const matches = cookie.split(";").map(x => x.trim()).filter(x => x.startsWith("kiiro_session="));
  if (matches.length !== 1) return null;
  const token = matches[0].slice("kiiro_session=".length);
  return /^[A-Za-z0-9_-]{32,256}$/.test(token) ? token : null;
}
export function validConsoleUpgrade(request: Pick<IncomingMessage, "url" | "headers">): boolean {
  if (process.env.CONSOLE_WS_ENABLED !== "true") return false;
  if (request.url !== PATH) return false;
  if (!originAllowed(request.headers.origin)) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  if (request.headers["sec-websocket-protocol"]) return false;
  if (!request.headers.cookie) return false;
  return true;
}
function reject(socket: import("node:stream").Duplex) {
  if (!socket.destroyed) socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}
const MAX_ACTIVE = 12;
const activeSessions = new Set<WebSocket>();
function openAuthorizedSocket(
  ws: WebSocket,
  sessionToken: string,
  prisma: PrismaService,
  sessions: SessionService,
) {
  if (activeSessions.size >= MAX_ACTIVE) { ws.close(1013, "Console capacity reached"); return; }
  activeSessions.add(ws);
  let authenticated = false, pending = false, finished = false;
  let bridge: ConsoleBridge | undefined;
  let auditUserId: string | undefined;
  let auditInstanceId: string | undefined;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearTimeout(authTimer);
    clearTimeout(absoluteTimer);
    clearInterval(revalidateTimer);
    activeSessions.delete(ws);
    if (bridge) void bridge.close();
  };
  const authTimer = setTimeout(() => {
    if (!authenticated) ws.close(1008, "Authorization timeout");
  }, AUTH_TIMEOUT_MS);
  authTimer.unref();
  const absoluteTimer = setTimeout(() => ws.close(1000, "Session expired"), 30 * 60_000);
  absoluteTimer.unref();
  const revalidateTimer = setInterval(() => {
    if (!authenticated || !auditUserId || !auditInstanceId || finished) return;
    void (async () => {
      const s = await sessions.validate(sessionToken);
      if (!s || s.userId !== auditUserId) throw new Error("Session revoked");
      const instance = await prisma.instance.findFirst({
        where: { id: auditInstanceId, deletedAt: null }, include: { node: true, provider: true },
      });
      if (!instance || instance.status !== "RUNNING" || instance.provider.slug !== "INCUS" ||
          instance.node.status !== "ONLINE" || !instance.node.lastSeenAt ||
          Date.now() - instance.node.lastSeenAt.getTime() > 180000 ||
          instance.node.lastSeenAt.getTime() > Date.now()) throw new Error("Console unavailable");
      const tasks = await prisma.task.findFirst({
        where: { instanceId: auditInstanceId, status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
      });
      if (tasks) throw new Error("Instance busy");
      if (s.user.role === "user") {
        const owner = await prisma.customer.findUnique({ where: { userId: s.userId }, select: { id: true } });
        if (!owner || owner.id !== instance.customerId) throw new Error("Ownership changed");
      } else if (s.user.role !== "admin") throw new Error("Access denied");
    })().catch(() => ws.close(1008, "Console authorization expired"));
  }, 15000);
  revalidateTimer.unref();
  ws.on("close", cleanup);
  ws.on("error", cleanup);
  ws.on("message", (raw, isBinary) => {
    if (finished || pending) return;
    const data = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
    if (isBinary || data.byteLength > (authenticated ? 12000 : MAX_AUTH_FRAME)) {
      ws.close(1009, "Console frame too large"); return;
    }
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      frame = parsed as Record<string, unknown>;
    } catch { ws.close(1008, "Invalid console frame"); return; }
    if (authenticated) {
      if (!bridge) return;
      pending = true;
      void bridge.receive(frame).catch(() => ws.close(1008, "Invalid terminal input"))
        .finally(() => { pending = false; });
      return;
    }
    pending = true;
    if (frame.type !== "authenticate" || typeof frame.ticket !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(frame.ticket)) {
      ws.close(1008, "Invalid authorization"); pending = false; return;
    }
    void authorizeConsoleGateway(frame.ticket, sessionToken, prisma, sessions)
      .then(async target => {
        authenticated = true;
        clearTimeout(authTimer);
        auditUserId = target.userId;
        auditInstanceId = target.instanceId;
        bridge = await connectConsoleBridge(ws, target, () => ws.close(1013, "Console disconnected"));
      }).catch(() => ws.close(1008, "Console unavailable"))
      .finally(() => { pending = false; });
  });
}

/**
 * Explicitly opt-in HTTP upgrade route. The Next.js /api/backend fetch proxy
 * cannot upgrade WebSockets: reverse proxy must route /api/console/ws directly
 * to the API container after gateway and worker bridge are production-ready.
 *
 * This milestone authenticates and closes, it DOES NOT execute guest commands.
 */
export function attachConsoleWebSocket(
  server: HttpServer,
  prisma: PrismaService,
  sessions: SessionService,
): void {
  if (process.env.CONSOLE_WS_ENABLED !== "true") return;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 });
  server.on("upgrade", (request, socket, head) => {
    // This hook handles only the known console route; unknown upgrade paths
    // must be rejected and never turned into a generic websocket service.
    if (!validConsoleUpgrade(request)) {
      reject(socket);
      return;
    }
    const sessionToken = cookieToken(request);
    if (!sessionToken) {
      reject(socket);
      return;
    }
    wss.handleUpgrade(request, socket, head, ws =>
      openAuthorizedSocket(ws, sessionToken, prisma, sessions));
  });
}
