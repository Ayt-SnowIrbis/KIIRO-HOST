import { createHash, randomBytes } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { ForbiddenException, ServiceUnavailableException, HttpException, HttpStatus } from "@nestjs/common";
import type { Request } from "express";

/**
 * Browser console tickets are disabled until the private gateway is deployed.
 * No Incus credentials, URLs or guest commands may cross this interface.
 */
export type ConsoleTicketClaims = {
  sessionId: string;
  userId: string;
  role: "admin" | "user";
  instanceId: string;
  nodeId: string;
  externalName: string;
};

const TICKET_TTL_SECONDS = 30;
let connection: Promise<RedisClientType> | undefined;
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
async function redis(): Promise<RedisClientType> {
  if (!connection) {
    const client = createClient({ url: process.env.REDIS_URL });
    connection = client.connect().then(() => client as RedisClientType).catch((error: unknown) => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}
export function assertConsoleOrigin(req: Request): void {
  // Require an explicitly configured HTTPS allowlist, not an untrusted Host header.
  const allowed = new Set(
    (process.env.CONSOLE_ALLOWED_ORIGINS ?? "").split(",")
      .map((s) => s.trim()).filter((s) => /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(s)),
  );
  const origin = req.headers.origin;
  if (!origin || !allowed.has(origin) || req.headers["sec-fetch-site"] === "cross-site") {
    throw new ForbiddenException("Invalid console origin");
  }
}
export async function issueConsoleTicket(claims: ConsoleTicketClaims, req: Request): Promise<{ ticket: string; expiresInSeconds: number }> {
  if (process.env.CONSOLE_TICKETS_ENABLED !== "true") {
    throw new ServiceUnavailableException("Console gateway not enabled");
  }
  assertConsoleOrigin(req);
  if (!/^kh-[a-z0-9-]{1,60}$/.test(claims.externalName) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(claims.instanceId) ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(claims.nodeId)) {
    throw new ForbiddenException("Invalid console target");
  }
  // Limit ticket issuance per authenticated session and instance.
  const client = await redis();
  const rateKey = "console:rate:" + sha256(claims.sessionId + ":" + claims.instanceId);
  if ((await client.set(rateKey, "1", { NX: true, EX: 5 })) !== "OK") {
    throw new HttpException("Console ticket rate exceeded", HttpStatus.TOO_MANY_REQUESTS);
  }
  const ticket = randomBytes(32).toString("base64url");
  const key = "console:ticket:" + sha256(ticket);
  await client.set(key, JSON.stringify(claims), { NX: true, EX: TICKET_TTL_SECONDS });
  return { ticket, expiresInSeconds: TICKET_TTL_SECONDS };
}

/** To be called only by an authenticated private gateway, never exposed as an HTTP endpoint.
 * GETDEL prevents ticket replay; gateway must revalidate actor session and instance state.
 */
export async function consumeConsoleTicket(ticket: string): Promise<ConsoleTicketClaims | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  const client = await redis();
  const stored = await client.getDel("console:ticket:" + sha256(ticket));
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const obj = value as Record<string, unknown>;
    if (["sessionId", "userId", "instanceId", "nodeId", "externalName"].some(k => typeof obj[k] !== "string")) return null;
    if (obj.role !== "admin" && obj.role !== "user") return null;
    return obj as ConsoleTicketClaims;
  } catch { return null; }
}
