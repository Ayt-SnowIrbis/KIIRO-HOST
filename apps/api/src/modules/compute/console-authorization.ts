import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.module";
import type { SessionService } from "../auth/services/session.service";
import type { ConsoleTicketClaims } from "./console-ticket";
import { consumeConsoleTicket } from "./console-ticket";
import { consoleAvailability } from "./console-policy";

export type ConsoleActor = {
  sessionId: string;
  userId: string;
  role: string;
};
export type ConsoleTarget = {
  id: string;
  customerId: string;
  nodeId: string;
  externalId: string | null;
};

/** Independent from authentication cookie parsing, suitable for unit testing. */
export function consoleClaimsMatchActor(
  claims: ConsoleTicketClaims,
  actor: ConsoleActor,
  target: ConsoleTarget,
  ownerUserId: string | null,
): boolean {
  return claims.sessionId === actor.sessionId &&
    claims.userId === actor.userId &&
    claims.role === actor.role &&
    (actor.role === "admin" || (actor.role === "user" && ownerUserId === actor.userId)) &&
    claims.instanceId === target.id &&
    claims.nodeId === target.nodeId &&
    claims.externalName === target.externalId;
}

/**
 * Private gateway-only ticket redemption. This function must not be
 * exported as a public HTTP route. The gateway checks HTTPS Origin and
 * authenticates the browser's session before it consumes the single-use
 * ticket, then rechecks DB ownership and instance state. Re-run the checks
 * at defined intervals during a long-lived session.
 */
export async function authorizeConsoleGateway(
  ticket: string,
  sessionToken: string,
  db: PrismaService,
  sessions: SessionService,
): Promise<{ userId: string; instanceId: string; nodeId: string; externalName: string }> {
  const actor = await sessions.validate(sessionToken);
  if (!actor || (actor.user.role !== "admin" && actor.user.role !== "user")) {
    throw new ForbiddenException("Console authorization denied");
  }

  // Consume only after session authentication. The ticket is irrevocably spent
  // even if the target becomes unavailable while the connection is opening.
  const claims = await consumeConsoleTicket(ticket);
  if (!claims) throw new ForbiddenException("Console authorization denied");

  const instance = await db.instance.findFirst({
    where: { id: claims.instanceId, deletedAt: null },
    include: { provider: true, node: true },
  });
  if (!instance) throw new ForbiddenException("Console authorization denied");

  const [activeTask, owner] = await Promise.all([
    db.task.findFirst({
      where: { instanceId: instance.id, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    }),
    actor.user.role === "user"
      ? db.customer.findUnique({ where: { userId: actor.userId }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  const ownerUserId = actor.user.role === "user" && owner?.id === instance.customerId
    ? actor.userId : null;
  if (!consoleClaimsMatchActor(
    claims,
    { sessionId: actor.sessionId, userId: actor.userId, role: actor.user.role },
    instance,
    ownerUserId,
  ) || !consoleAvailability(instance, Boolean(activeTask)).available || !instance.externalId) {
    throw new ForbiddenException("Console authorization denied");
  }

  return {
    userId: actor.userId,
    instanceId: instance.id,
    nodeId: instance.nodeId,
    externalName: instance.externalId,
  };
}
