import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException,
  Get, Module, NotFoundException, Param, Post, Req, UnauthorizedException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";
import { PrismaService } from "../database/prisma.module";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function requiredText(value: unknown, field: string, max = 120): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new BadRequestException("Invalid " + field);
  }
  return value.trim();
}
function positiveInt(value: unknown, field: string, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) {
    throw new BadRequestException("Invalid " + field);
  }
  return Number(value);
}
const validId = /^[A-Za-z0-9_-]{1,128}$/;

@Controller("compute/admin/provisioning")
class VpsProvisioningController {
  constructor(private readonly db: PrismaService, private readonly sessions: SessionService) {}

  private async actor(req: Request): Promise<string> {
    const token = (req.headers.cookie ?? "").split(";").map(v => v.trim())
      .find(v => v.startsWith("kiiro_session="))?.slice("kiiro_session=".length);
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();
    if (session.user.role !== "admin") throw new ForbiddenException();
    return session.userId;
  }

  @Post("regions")
  async createRegion(@Req() req: Request, @Body() raw: unknown) {
    const userId = await this.actor(req);
    const body = record(raw);
    const code = requiredText(body.code, "region code", 16).toUpperCase();
    const name = requiredText(body.name, "region name", 120);
    const country = requiredText(body.country, "country", 2).toUpperCase();
    if (!/^[A-Z0-9_-]{2,16}$/.test(code) || !/^[A-Z]{2}$/.test(country)) throw new BadRequestException("Invalid region code or country");
    const region = await this.db.region.create({ data: { code, name, country, enabled: true } });
    await this.db.auditLog.create({ data: { userId, action: "INFRA_REGION_CREATED", entityType: "REGION", entityId: region.id } });
    return region;
  }

  @Post("nodes/:id/region")
  async moveNodeRegion(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const userId = await this.actor(req);
    const regionId = requiredText(record(raw).regionId, "regionId");
    const [node, region] = await Promise.all([
      this.db.node.findUnique({ where: { id }, include: { _count: { select: { instances: true, ipPools: true } } } }),
      this.db.region.findUnique({ where: { id: regionId } }),
    ]);
    if (!node || !region) throw new NotFoundException("Node or region not found");
    if (node.status !== "MAINTENANCE" && node.status !== "OFFLINE") throw new ConflictException("Place node in maintenance before changing region");
    if (node._count.instances || node._count.ipPools) throw new ConflictException("Node must have no instances or IP pools to change region");
    const updated = await this.db.node.update({ where: { id }, data: { regionId }, select: { id: true, regionId: true, name: true } });
    await this.db.auditLog.create({ data: { userId, action: "INFRA_NODE_REGION_CHANGED", entityType: "NODE", entityId: id, metadata: { regionId } } });
    return updated;
  }

  @Get("monitoring")
  async monitoring(@Req() req: Request) {
    await this.actor(req);
    const [nodes, tasks, failedTasks] = await Promise.all([
      this.db.node.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, status: true, lastSeenAt: true,
          totalVcpu: true, reservedVcpu: true, totalMemoryMb: true, reservedMemoryMb: true,
          totalDiskGb: true, reservedDiskGb: true, metadata: true,
          region: { select: { code: true, name: true } },
        },
      }),
      this.db.task.findMany({
        take: 30, orderBy: { createdAt: "desc" },
        select: { id: true, type: true, status: true, instanceId: true, attempts: true, lastError: true, createdAt: true, finishedAt: true },
      }),
      this.db.task.count({ where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ]);
    const now = Date.now();
    return {
      nodes: nodes.map(n => {
        const age = n.lastSeenAt ? Math.max(0, Math.floor((now - n.lastSeenAt.getTime()) / 1000)) : null;
        const stale = age === null || age > 180;
        return {
          id: n.id, name: n.name, region: n.region, status: stale && n.status === "ONLINE" ? "DEGRADED" : n.status,
          heartbeatAgeSeconds: age, totalVcpu: n.totalVcpu, reservedVcpu: n.reservedVcpu,
          totalMemoryMb: n.totalMemoryMb.toString(), reservedMemoryMb: n.reservedMemoryMb.toString(),
          totalDiskGb: n.totalDiskGb.toString(), reservedDiskGb: n.reservedDiskGb.toString(),
          inventory: record(n.metadata).inventory ?? null,
          provisioning: record(n.metadata).provisioning ?? null,
        };
      }),
      tasks,
      failedTasksLast24h: failedTasks,
    };
  }

  @Post("nodes/:id/config")
  async configureNode(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const userId = await this.actor(req);
    if (!validId.test(id)) throw new BadRequestException("Invalid node ID");
    const body = record(raw);
    const network = requiredText(body.network, "network", 120);
    const storagePool = requiredText(body.storagePool, "storagePool", 120);
    const networkMode = body.networkMode === undefined ? "bridged" : requiredText(body.networkMode, "networkMode", 16);
    if (networkMode !== "bridged" && networkMode !== "routed") throw new BadRequestException("Invalid networkMode");
    const parent = networkMode === "routed" ? requiredText(body.parent, "parent", 31) : null;
    if (parent && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,30}$/.test(parent)) throw new BadRequestException("Invalid parent interface");
    const node = await this.db.node.findUnique({ where: { id }, include: { provider: true } });
    if (!node) throw new NotFoundException("Node not found");
    if (node.provider.slug !== "INCUS") throw new BadRequestException("Only Incus nodes are supported");
    const meta = record(node.metadata);
    const inventory = record(meta.inventory);
    const networks = Array.isArray(inventory.networks) ? inventory.networks : [];
    const pools = Array.isArray(inventory.storagePools) ? inventory.storagePools : [];
    if (networkMode === "bridged" && networks.length && !networks.includes(network)) throw new BadRequestException("Network is not present in the latest Incus inventory");
    if (pools.length && !pools.includes(storagePool)) throw new BadRequestException("Storage pool is not present in the latest Incus inventory");
    const updated = await this.db.node.update({
      where: { id },
      data: { metadata: { ...meta, provisioning: { network, storagePool, enabled: true, networkMode, ...(parent ? { parent } : {}) } } as Prisma.InputJsonValue },
      select: { id: true, name: true, status: true, metadata: true },
    });
    await this.db.auditLog.create({ data: { userId, action: "INFRA_NODE_PROVISIONING_CONFIGURED", entityType: "NODE", entityId: id, metadata: { network, storagePool, networkMode, parent } } });
    return { id: updated.id, name: updated.name, status: updated.status, provisioning: { network, storagePool, enabled: true, networkMode, ...(parent ? { parent } : {}) } };
  }

  @Post("images/:id/incus-alias")
  async configureImageAlias(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const userId = await this.actor(req);
    const alias = requiredText(record(raw).alias, "Incus image alias", 160);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(alias)) throw new BadRequestException("Invalid Incus image alias");
    const image = await this.db.osImage.findUnique({ where: { id }, include: { provider: true } });
    if (!image || image.provider.slug !== "INCUS") throw new NotFoundException("Incus image not found");
    await this.db.osImage.update({ where: { id }, data: { metadata: { ...record(image.metadata), incusAlias: alias } as Prisma.InputJsonValue } });
    await this.db.auditLog.create({ data: { userId, action: "INCUS_IMAGE_ALIAS_CONFIGURED", entityType: "OS_IMAGE", entityId: id, metadata: { alias } } });
    return { id, alias };
  }

  @Post("pools/:id/bind")
  async bindPool(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const userId = await this.actor(req);
    const nodeId = requiredText(record(raw).nodeId, "nodeId");
    const [pool, node] = await Promise.all([
      this.db.ipPool.findUnique({ where: { id }, include: { addresses: true } }),
      this.db.node.findUnique({ where: { id: nodeId }, include: { provider: true } }),
    ]);
    if (!pool || !node) throw new NotFoundException("Pool or node not found");
    if (node.provider.slug !== "INCUS" || node.regionId !== pool.regionId) throw new BadRequestException("Pool and node must belong to the same Incus region");
    if (pool.nodeId && pool.nodeId !== nodeId) throw new ConflictException("Pool is already bound to another node");
    if (pool.addresses.some(a => a.instanceId || a.status === "ASSIGNED" || a.status === "RESERVED")) throw new ConflictException("Cannot bind a pool with allocated addresses");
    await this.db.ipPool.update({ where: { id }, data: { nodeId } });
    await this.db.auditLog.create({ data: { userId, action: "INFRA_POOL_BOUND_TO_NODE", entityType: "IP_POOL", entityId: id, metadata: { nodeId } } });
    return { id, nodeId, bound: true };
  }

  @Post("instances")
  async provision(@Req() req: Request, @Body() raw: unknown) {
    const userId = await this.actor(req);
    const body = record(raw);
    const customerId = requiredText(body.customerId, "customerId");
    const regionId = requiredText(body.regionId, "regionId");
    const planId = requiredText(body.planId, "planId");
    const imageId = requiredText(body.imageId, "imageId");
    const name = requiredText(body.name, "name");
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/.test(name)) throw new BadRequestException("Instance name must be a DNS-safe label");
    const [customer, plan, image, provider] = await Promise.all([
      this.db.customer.findUnique({ where: { id: customerId }, select: { id: true } }),
      this.db.plan.findUnique({ where: { id: planId } }),
      this.db.osImage.findUnique({ where: { id: imageId } }),
      this.db.provider.findUnique({ where: { slug: "INCUS" } }),
    ]);
    if (!customer) throw new NotFoundException("Customer not found");
    if (!plan || !plan.enabled) throw new BadRequestException("Plan is unavailable");
    if (!image || !image.enabled || !provider || image.providerId !== provider.id) throw new BadRequestException("Incus image is unavailable");
    if (!plan.kindSupport.includes("CONTAINER") || !image.kindSupport.includes("CONTAINER")) throw new BadRequestException("Selected plan/image does not support Incus containers");
    const imageMeta = record(image.metadata);
    const imageAlias = requiredText(imageMeta.incusAlias ?? image.slug, "Incus image alias", 160);
    const candidates = await this.db.node.findMany({
      where: { providerId: provider.id, regionId, status: "ONLINE", lastSeenAt: { gte: new Date(Date.now() - 180000) } },
      include: { provider: true },
      orderBy: [{ reservedVcpu: "asc" }, { reservedMemoryMb: "asc" }],
    });
    if (!candidates.length) throw new ConflictException("No ONLINE Incus node is available in this region");

    return this.db.$transaction(async tx => {
      for (const candidate of candidates) {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT id FROM "nodes" WHERE id = $1 AND status = \'ONLINE\' FOR UPDATE',
          candidate.id,
        );
        if (!locked.length) continue;
        const node = await tx.node.findUnique({ where: { id: candidate.id } });
        if (!node) continue;
        if (node.totalVcpu - node.reservedVcpu < plan.vcpu ||
            node.totalMemoryMb - node.reservedMemoryMb < BigInt(plan.memoryMb) ||
            node.totalDiskGb - node.reservedDiskGb < BigInt(plan.diskGb)) continue;
        const nodeMeta = record(node.metadata);
        if (nodeMeta.mode !== "REAL") continue;
        const provisioning = record(nodeMeta.provisioning);
        if (provisioning.enabled !== true) continue;
        const network = requiredText(provisioning.network, "node network", 120);
        const storagePool = requiredText(provisioning.storagePool, "node storage pool", 120);
        const networkMode = provisioning.networkMode === "routed" ? "routed" : "bridged";
        const parent = networkMode === "routed" ? requiredText(provisioning.parent, "node routed parent", 31) : null;
        const addresses = await tx.$queryRawUnsafe<Array<{ id: string; address: string; gateway: string | null }>>(
          'SELECT a.id, a.address, p.gateway FROM "ip_addresses" a JOIN "ip_pools" p ON p.id = a.pool_id WHERE p.node_id = $1 AND p.region_id = $2 AND p.family = \'IPV4\' AND a.status = \'AVAILABLE\' AND a.instance_id IS NULL AND a.address NOT LIKE \'192.0.2.%\' AND a.address NOT LIKE \'192.0.3.%\' AND ($3::text <> \'routed\' OR p.cidr = a.address || \'/32\') ORDER BY a.address FOR UPDATE OF a SKIP LOCKED LIMIT 1',
          node.id, regionId, networkMode,
        );
        const ip = addresses[0];
        if (!ip) continue;
        const instance = await tx.instance.create({
          data: {
            customerId, providerId: provider.id, nodeId: node.id, regionId, imageId, planId,
            name, kind: "CONTAINER", status: "PROVISIONING", desiredState: "RUNNING",
            observedState: "UNKNOWN", vcpu: plan.vcpu, memoryMb: plan.memoryMb, diskGb: plan.diskGb,
            metadata: { mode: "REAL", provisioning: "INCUS", requestedBy: userId } as Prisma.InputJsonValue,
          },
        });
        const externalName = "kh-" + instance.id;
        await tx.instance.update({ where: { id: instance.id }, data: { externalId: externalName } });
        await tx.ipAddress.update({ where: { id: ip.id }, data: { status: "ASSIGNED", instanceId: instance.id } });
        await tx.instanceAddress.create({ data: { instanceId: instance.id, family: "IPV4", address: ip.address, isPrimary: true } });
        await tx.node.update({
          where: { id: node.id },
          data: { reservedVcpu: { increment: plan.vcpu }, reservedMemoryMb: { increment: BigInt(plan.memoryMb) }, reservedDiskGb: { increment: BigInt(plan.diskGb) } },
        });
        const task = await tx.task.create({
          data: {
            instanceId: instance.id, type: "PROVISION", status: "QUEUED", maxAttempts: 1,
            payload: { mode: "REAL", nodeId: node.id, externalName, imageAlias, network, storagePool, networkMode, parent, address: ip.address, gateway: ip.gateway, vcpu: plan.vcpu, memoryMb: plan.memoryMb, diskGb: plan.diskGb } as Prisma.InputJsonValue,
          },
          select: { id: true, type: true, status: true, createdAt: true },
        });
        await tx.instanceEvent.create({ data: { instanceId: instance.id, eventType: "PROVISIONING_QUEUED", payload: { taskId: task.id, nodeId: node.id, address: ip.address } } });
        await tx.auditLog.create({ data: { userId, action: "INSTANCE_PROVISION_QUEUED", entityType: "INSTANCE", entityId: instance.id, metadata: { taskId: task.id, nodeId: node.id, ip: ip.address } } });
        return { instanceId: instance.id, externalName, nodeId: node.id, address: ip.address, status: "PROVISIONING", task };
      }
      throw new ConflictException("No Incus node has sufficient resources and a free node-bound IP address");
    }, { isolationLevel: "Serializable", timeout: 15000 });
  }

  @Delete("instances/:id")
  async deleteInstance(@Req() req: Request, @Param("id") id: string) {
    const userId = await this.actor(req);
    if (!validId.test(id)) throw new BadRequestException("Invalid instance ID");
    return this.db.$transaction(async tx => {
      const instance = await tx.instance.findFirst({ where: { id, deletedAt: null }, include: { node: true, provider: true } });
      if (!instance) throw new NotFoundException("Instance not found");
      if (instance.provider.slug !== "INCUS" || instance.node.status !== "ONLINE" || !instance.externalId || !instance.externalId.startsWith("kh-") || record(instance.metadata).provisioning !== "INCUS") {
        throw new ConflictException("Instance node must be ONLINE and the Incus instance must be registered");
      }
      const pending = await tx.task.findFirst({ where: { instanceId: id, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
      if (pending) throw new ConflictException("Instance already has an active task");
      const task = await tx.task.create({ data: { instanceId: id, type: "DELETE", status: "QUEUED", maxAttempts: 1, payload: { mode: "REAL", nodeId: instance.nodeId } }, select: { id: true, type: true, status: true } });
      await tx.instance.update({ where: { id }, data: { status: "DELETING" } });
      await tx.auditLog.create({ data: { userId, action: "INSTANCE_DELETE_QUEUED", entityType: "INSTANCE", entityId: id, metadata: { taskId: task.id } } });
      return { accepted: true, instanceId: id, task };
    });
  }
}


@Controller("compute/admin/plans")
class PlanCatalogManagementController {
  constructor(private readonly db: PrismaService, private readonly sessions: SessionService) {}
  private async actor(req: Request): Promise<string> {
    const token = (req.headers.cookie ?? "").split(";").map(v => v.trim())
      .find(v => v.startsWith("kiiro_session="))?.slice("kiiro_session=".length);
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();
    if (session.user.role !== "admin") throw new ForbiddenException();
    return session.userId;
  }

  @Post()
  async createPlan(@Req() req: Request, @Body() raw: unknown) {
    const userId = await this.actor(req);
    const body = record(raw);
    const slug = requiredText(body.slug, "slug", 100).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug)) throw new BadRequestException("Invalid plan slug");
    const name = requiredText(body.name, "name", 160);
    const vcpu = positiveInt(body.vcpu, "vcpu", 256);
    const memoryMb = positiveInt(body.memoryMb, "memoryMb", 1048576);
    const diskGb = positiveInt(body.diskGb, "diskGb", 100000);
    const regionId = requiredText(body.regionId, "regionId");
    const region = await this.db.region.findUnique({ where: { id: regionId } });
    if (!region || !region.enabled) throw new BadRequestException("Enabled region required");
    if (await this.db.plan.findUnique({ where: { slug } })) throw new ConflictException("Plan slug already exists");
    return this.db.$transaction(async tx => {
      const plan = await tx.plan.create({
        data: { slug, name, vcpu, memoryMb, diskGb, kindSupport: ["CONTAINER"], enabled: false,
          regions: { create: [{ regionId }] } },
      });
      await tx.auditLog.create({ data: { userId, action: "PLAN_CREATED", entityType: "PLAN", entityId: plan.id } });
      return { id: plan.id, slug: plan.slug, enabled: plan.enabled };
    });
  }

  @Post(":id/prices/:priceId/deactivate")
  async deactivatePrice(@Req() req: Request, @Param("id") id: string, @Param("priceId") priceId: string) {
    const userId = await this.actor(req);
    if (!validId.test(id) || !validId.test(priceId)) throw new BadRequestException("Invalid price identifier");
    return this.db.$transaction(async tx => {
      const price = await tx.planPrice.findFirst({ where: { id: priceId, planId: id } });
      if (!price) throw new NotFoundException("Plan price not found");
      if (!price.active) return { id: price.id, active: false };
      const updated = await tx.planPrice.update({ where: { id: priceId }, data: { active: false, validUntil: new Date() } });
      await tx.auditLog.create({ data: { userId, action: "PLAN_PRICE_DEACTIVATED", entityType: "PLAN_PRICE", entityId: priceId, metadata: { planId: id } } });
      return { id: updated.id, active: false };
    });
  }

  @Post(":id/prices")
  async addPrice(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const userId = await this.actor(req);
    if (!validId.test(id)) throw new BadRequestException("Invalid plan ID");
    const body = record(raw);
    const billingModel = requiredText(body.billingModel, "billingModel", 16);
    if (billingModel !== "PREPAID" && billingModel !== "SUBSCRIPTION") throw new BadRequestException("Invalid billing model");
    const currency = requiredText(body.currency, "currency", 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("Invalid currency");
    const amountMinor = body.amountMinor;
    if (typeof amountMinor !== "string" || !/^[0-9]{1,15}$/.test(amountMinor) || BigInt(amountMinor) === 0n)
      throw new BadRequestException("Invalid price amount");
    const interval = requiredText(body.interval, "interval", 16);
    if (!/^(hour|day|month|year)$/.test(interval)) throw new BadRequestException("Invalid billing interval");
    if (!await this.db.plan.findUnique({ where: { id } })) throw new NotFoundException("Plan not found");
    return this.db.$transaction(async tx => {
      const active = await tx.planPrice.findFirst({ where: { planId: id, billingModel, currency, interval, active: true } });
      if (active) throw new ConflictException("Retire the existing active price for this model, currency and interval first");
      const price = await tx.planPrice.create({ data: {
        planId: id, billingModel, currency, amountMinor: BigInt(amountMinor), interval, active: true,
      } });
      await tx.auditLog.create({ data: { userId, action: "PLAN_PRICE_CREATED", entityType: "PLAN_PRICE", entityId: price.id,
        metadata: { planId: id, billingModel, currency, amountMinor, interval } } });
      return { id: price.id, planId: id, amountMinor, currency, billingModel, interval };
    });
  }
}


@Controller("compute/admin/image-catalog")
class ImageCatalogManagementController {
  constructor(private readonly db: PrismaService, private readonly sessions: SessionService) {}
  private async actor(req: Request): Promise<string> {
    const token = (req.headers.cookie ?? "").split(";").map(v => v.trim())
      .find(v => v.startsWith("kiiro_session="))?.slice("kiiro_session=".length);
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();
    if (session.user.role !== "admin") throw new ForbiddenException();
    return session.userId;
  }
  @Post()
  async createImage(@Req() req: Request, @Body() raw: unknown) {
    const userId = await this.actor(req);
    const body = record(raw);
    const slug = requiredText(body.slug, "slug", 100).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(slug)) throw new BadRequestException("Invalid image slug");
    const name = requiredText(body.name, "name", 160);
    const version = requiredText(body.version, "version", 80);
    const osFamily = requiredText(body.osFamily, "osFamily", 60);
    const alias = requiredText(body.incusAlias, "incusAlias", 160);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(alias)) throw new BadRequestException("Invalid Incus alias");
    const provider = await this.db.provider.findFirst({ where: { slug: "INCUS" } });
    if (!provider) throw new NotFoundException("Incus provider not configured");
    return this.db.$transaction(async tx => {
      if (await tx.osImage.findFirst({ where: { providerId: provider.id, slug } })) throw new ConflictException("Image slug already exists");
      const created = await tx.osImage.create({ data: {
        providerId: provider.id, slug, name, version, osFamily,
        kindSupport: ["CONTAINER"], enabled: false, metadata: { mode: "REAL", incusAlias: alias },
      } });
      await tx.auditLog.create({ data: { userId, action: "OS_IMAGE_CREATED", entityType: "OS_IMAGE", entityId: created.id } });
      return { id: created.id, slug, enabled: false };
    });
  }
}

@Module({ imports: [AuthModule], controllers: [VpsProvisioningController, PlanCatalogManagementController, ImageCatalogManagementController] })
export class VpsProvisioningModule {}
