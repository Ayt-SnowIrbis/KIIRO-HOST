import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { PrismaService } from "../database/prisma.module";
import type { SessionService } from "../auth/services/session.service";
import { authorizeConsoleGateway } from "./console-authorization";

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
function openAuthorizedSocket(
  ws: WebSocket,
  sessionToken: string,
  prisma: PrismaService,
  sessions: SessionService,
) {
  let started = false;
  let finished = false;
  const stop = () => {
    finished = true;
    clearTimeout(timer);
  };
  const timer = setTimeout(() => {
    if (!finished) ws.close(1008, "Authorization timeout");
  }, AUTH_TIMEOUT_MS);
  timer.unref();
  ws.on("close", stop);
  ws.on("error", stop);
  ws.on("message", async (raw, isBinary) => {
    if (finished || started) return;
    started = true;
    if (isBinary || raw.length > MAX_AUTH_FRAME) {
      ws.close(1008, "Invalid authorization");
      return;
    }
    try {
      const payload: unknown = JSON.parse(raw.toString("utf8"));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
      const frame = payload as Record<string, unknown>;
      if (frame.type !== "authenticate" ||
          typeof frame.ticket !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(frame.ticket)) throw new Error();
      // Server-side fresh user/owner/node/task authorization. Never log
      // the ticket or guest data, and never trust a client-supplied node ID.
      await authorizeConsoleGateway(frame.ticket, sessionToken, prisma, sessions);
      // Deliberately fail closed. The separate authenticated worker bridge
      // is not yet implemented. Do not pretend this is an interactive shell.
      if (!finished && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "unavailable", reason: "CONSOLE_BRIDGE_NOT_CONFIGURED" }));
        ws.close(1013, "Console bridge unavailable");
      }
    } catch {
      if (!finished && ws.readyState === WebSocket.OPEN) ws.close(1008, "Authorization denied");
    } finally {
      stop();
    }
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
