import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { isIP } from "node:net";
import type { Request } from "express";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";
import { PrismaService } from "../database/prisma.module";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("JSON object required");
  return value as Record<string, unknown>;
}
function str(value: unknown, label: string, max = 120): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequestException("Invalid " + label);
  return value.trim();
}
function ipNumber(ip: string): { family: number; number: bigint } {
  const family = isIP(ip);
  if (!family) throw new BadRequestException("Invalid IP address");
  if (family === 4) return { family, number: ip.split(".").reduce((a, b) => (a << 8n) | BigInt(b), 0n) };
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) throw new BadRequestException("Invalid IPv6 address");
  const parse = (s: string) => s ? s.split(":").map((p) => {
    if (!/^[0-9a-f]{1,4}$/.test(p)) throw new BadRequestException("Invalid IPv6 address");
    return BigInt("0x" + p);
  }) : [];
  const left = parse(halves[0]), right = parse(halves[1] ?? "");
  if (halves.length === 2 && left.length + right.length >= 8) throw new BadRequestException("Invalid IPv6 compression");
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0n), ...right] : left;
  if (groups.length !== 8) throw new BadRequestException("Invalid IPv6 address");
  return { family, number: groups.reduce((a: bigint, b: bigint) => (a << 16n) | b, 0n) };
}
function cidrRange(input: string) {
  const [ip, prefix, extra] = input.split("/");
  const address = ipNumber(ip);
  const bits = address.family === 4 ? 32 : 128;
  if (extra !== undefined || !/^(0|[1-9]\d*)$/.test(prefix ?? "") || Number(prefix) > bits) throw new BadRequestException("Invalid CIDR");
  const p = Number(prefix);
  const shift = BigInt(bits - p);
  const start = (address.number >> shift) << shift;
  return { family: address.family, start, end: start + (1n << shift) - 1n };
}

@Controller("compute/admin/infrastructure")
class InfrastructureController {
  constructor(private readonly db: PrismaService, private readonly sessions: SessionService) {}
  private async actor(req: Request) {
    const token = (req.headers.cookie ?? "").split(";").map(s => s.trim()).find(s => s.startsWith("kiiro_session="))?.slice(14);
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();
    if (session.user.role !== "admin") throw new ForbiddenException();
    return session.userId;
  }
  private async audit(userId: string, action: string, entityType: string, entityId: string) {
    await this.db.auditLog.create({ data: { userId, action, entityType, entityId } });
  }

  @Get("providers")
  async providers(@Req() req: Request) {
    await this.actor(req);
    return this.db.provider.findMany({ where: { slug: "INCUS" }, select: { id: true, name: true, slug: true } });
  }

  @Get("overview")
  async overview(@Req() req: Request) {
    await this.actor(req);
    const [nodes, pools, addresses, instances] = await Promise.all([
      this.db.node.findMany({ select: { id: true, name: true, status: true, lastSeenAt: true, totalVcpu: true, reservedVcpu: true, totalMemoryMb: true, reservedMemoryMb: true, totalDiskGb: true, reservedDiskGb: true, region: { select: { code: true } }, provider: { select: { slug: true } }, _count: { select: { instances: true } } } }),
      this.db.ipPool.findMany({ select: { id: true, regionId: true, cidr: true, family: true, gateway: true, _count: { select: { addresses: true } } } }),
      this.db.ipAddress.groupBy({ by: ["status"], _count: { _all: true } }),
      this.db.instance.count({ where: { deletedAt: null } }),
    ]);
    return { nodes: nodes.map(n => ({ ...n, totalMemoryMb: String(n.totalMemoryMb), reservedMemoryMb: String(n.reservedMemoryMb), totalDiskGb: String(n.totalDiskGb), reservedDiskGb: String(n.reservedDiskGb) })), pools, addresses, instances };
  }

  @Post("nodes")
  async addNode(@Req() req: Request, @Body() raw: unknown) {
    const userId = await this.actor(req), body = object(raw);
    const providerId = str(body.providerId, "providerId"), regionId = str(body.regionId, "regionId");
    const name = str(body.name, "name");
    const [provider, region] = await Promise.all([this.db.provider.findUnique({ where: { id: providerId } }), this.db.region.findUnique({ where: { id: regionId } })]);
    if (!provider || !region) throw new BadRequestException("Unknown provider or region");
    if (provider.slug !== "INCUS") throw new BadRequestException("Only Incus node registration is supported");
    const node = await this.db.$transaction(async tx => {
      const created = await tx.node.create({ data: { providerId, regionId, name, status: "OFFLINE", metadata: { mode: "REAL", configured: false, managed: true } } });
      await tx.auditLog.create({ data: { userId, action: "INFRA_NODE_CREATED", entityType: "NODE", entityId: created.id } });
      return created;
    });
    return { id: node.id, name: node.name, status: node.status, connectionConfigured: false };
  }

  @Delete("nodes/:id")
  async deleteNode(@Req() req: Request, @Param("id") id: string) {
    const userId = await this.actor(req);
    const node = await this.db.node.findUnique({ where: { id }, select: { status: true, _count: { select: { instances: true } } } });
    if (!node) throw new NotFoundException("Node not found");
    if (node.status !== "OFFLINE" && node.status !== "MAINTENANCE") throw new ConflictException("Node must be OFFLINE or MAINTENANCE");
    if (node._count.instances) throw new ConflictException("Node has instance records; migrate or retire them first");
    const pending = await this.db.task.count({ where: { instance: { nodeId: id }, status: { in: ["QUEUED", "RUNNING"] } } });
    if (pending) throw new ConflictException("Node has pending tasks");
    await this.db.$transaction(async tx => {
      const current = await tx.node.findUnique({ where: { id }, select: { status: true, _count: { select: { instances: true } } } });
      if (!current || current._count.instances || !["OFFLINE", "MAINTENANCE"].includes(current.status)) throw new ConflictException("Node no longer removable");
      await tx.node.delete({ where: { id } });
      await tx.auditLog.create({ data: { userId, action: "INFRA_NODE_DELETED", entityType: "NODE", entityId: id } });
    });
    return { deleted: true };
  }

  @Get("pools")
  async pools(@Req() req: Request) {
    await this.actor(req);
    return this.db.ipPool.findMany({ include: { addresses: { select: { id: true, address: true, status: true, instanceId: true } } }, orderBy: { createdAt: "desc" } });
  }

  @Post("pools")
  async addPool(@Req() req: Request, @Body() raw: unknown) {
    const userId = await this.actor(req), body = object(raw);
    const regionId = str(body.regionId, "regionId");
    const cidr = str(body.cidr, "cidr", 64), range = cidrRange(cidr);
    const gateway = body.gateway == null || body.gateway === "" ? null : str(body.gateway, "gateway", 64);
    if (gateway) {
      const g = ipNumber(gateway);
      if (g.family !== range.family || g.number < range.start || g.number > range.end) throw new BadRequestException("Gateway must belong to CIDR");
    }
    if (!await this.db.region.findUnique({ where: { id: regionId } })) throw new NotFoundException("Region not found");
    const existing = await this.db.ipPool.findMany({ where: { regionId }, select: { cidr: true } });
    if (existing.some(p => { const r = cidrRange(p.cidr); return r.family === range.family && r.start <= range.end && range.start <= r.end; })) throw new ConflictException("Overlapping pool in region");
    const pool = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${regionId}))`;
      const peers = await tx.ipPool.findMany({ where: { regionId }, select: { cidr: true } });
      if (peers.some(p => { const r = cidrRange(p.cidr); return r.family === range.family && r.start <= range.end && range.start <= r.end; })) throw new ConflictException("Overlapping pool in region");
      const created = await tx.ipPool.create({ data: { regionId, cidr, family: range.family === 4 ? "IPV4" : "IPV6", gateway } });
      await tx.auditLog.create({ data: { userId, action: "INFRA_POOL_CREATED", entityType: "IP_POOL", entityId: created.id } });
      return created;
    }, { isolationLevel: "Serializable" });
    return pool;
  }

  @Delete("pools/:id")
  async deletePool(@Req() req: Request, @Param("id") id: string) {
    const userId = await this.actor(req);
    const pool = await this.db.ipPool.findUnique({ where: { id }, select: { _count: { select: { addresses: true } } } });
    if (!pool) throw new NotFoundException("Pool not found");
    if (pool._count.addresses) throw new ConflictException("Pool contains addresses; remove them first");
    await this.db.$transaction(async tx => {
      const current = await tx.ipPool.findUnique({ where: { id }, select: { _count: { select: { addresses: true } } } });
      if (!current || current._count.addresses) throw new ConflictException("Pool no longer empty");
      await tx.ipPool.delete({ where: { id } });
      await tx.auditLog.create({ data: { userId, action: "INFRA_POOL_DELETED", entityType: "IP_POOL", entityId: id } });
    });
    return { deleted: true };
  }

  @Post("pools/:id/addresses")
  async addAddress(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const userId = await this.actor(req), body = object(raw), address = str(body.address, "address", 64);
    const pool = await this.db.ipPool.findUnique({ where: { id } });
    if (!pool) throw new NotFoundException("Pool not found");
    const range = cidrRange(pool.cidr), ip = ipNumber(address);
    if (ip.family !== range.family || ip.number < range.start || ip.number > range.end || address === pool.gateway) throw new BadRequestException("Address outside pool or reserved gateway");
    const entry = await this.db.$transaction(async tx => {
      const created = await tx.ipAddress.create({ data: { poolId: id, address, status: "AVAILABLE" } });
      await tx.auditLog.create({ data: { userId, action: "INFRA_ADDRESS_ADDED", entityType: "IP_ADDRESS", entityId: created.id } });
      return created;
    });
    return entry;
  }

  @Delete("addresses/:id")
  async deleteAddress(@Req() req: Request, @Param("id") id: string) {
    const userId = await this.actor(req);
    const entry = await this.db.ipAddress.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException("Address not found");
    if (entry.status !== "AVAILABLE" || entry.instanceId) throw new ConflictException("Only unallocated AVAILABLE addresses can be removed");
    await this.db.$transaction(async tx => {
      const deleted = await tx.ipAddress.deleteMany({ where: { id, status: "AVAILABLE", instanceId: null } });
      if (!deleted.count) throw new ConflictException("Address is no longer available");
      await tx.auditLog.create({ data: { userId, action: "INFRA_ADDRESS_DELETED", entityType: "IP_ADDRESS", entityId: id } });
    });
    return { deleted: true };
  }
}

@Module({ imports: [AuthModule], controllers: [InfrastructureController] })
export class InfrastructureModule {}
