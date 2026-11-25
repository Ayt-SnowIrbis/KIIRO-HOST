import {
  BadRequestException, ConflictException, Controller, ForbiddenException,
  Get, Module, NotFoundException, Param, Post, Req, UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";
import { PrismaService } from "../database/prisma.module";

type LifecycleAction = "START" | "STOP" | "REBOOT";

@Controller("compute/customer/instances")
class CustomerInstancesController {
  constructor(private readonly prisma: PrismaService, private readonly sessions: SessionService) {}

  private async actor(request: Request) {
    const token = (request.headers.cookie ?? "").split(";").map((v) => v.trim())
      .find((v) => v.startsWith("kiiro_session="))?.slice("kiiro_session=".length);
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();
    if (session.user.role !== "user") throw new ForbiddenException("Customer account required");
    const customer = await this.prisma.customer.findUnique({
      where: { userId: session.userId }, select: { id: true },
    });
    if (!customer) throw new NotFoundException("Customer profile not found");
    return { userId: session.userId, customerId: customer.id };
  }

  @Get()
  async list(@Req() request: Request) {
    const { customerId } = await this.actor(request);
    const rows = await this.prisma.instance.findMany({
      where: { customerId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100,
      include: {
        provider: { select: { name: true, slug: true } },
        node: { select: { name: true, status: true } },
        region: { select: { name: true, code: true } },
        addresses: { select: { family: true, address: true, isPrimary: true } },
        tasks: { where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true }, take: 1 },
      },
    });
    return rows.map((i) => ({
      id: i.id, name: i.name, kind: i.kind.toLowerCase(), status: i.status.toLowerCase(),
      provider: { name: i.provider.name, slug: i.provider.slug.toLowerCase() },
      node: i.node, region: i.region, addresses: i.addresses,
      vcpu: i.vcpu, memoryMb: i.memoryMb, diskGb: i.diskGb, createdAt: i.createdAt,
      hasActiveTask: i.tasks.length > 0,
      mode: typeof i.metadata === "object" && i.metadata !== null && !Array.isArray(i.metadata) && i.metadata["mode"] === "MOCK" ? "mock" : "real",
    }));
  }

  @Get(":id")
  async detail(@Req() request: Request, @Param("id") id: string) {
    const { customerId } = await this.actor(request);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Invalid instance ID");
    const i = await this.prisma.instance.findFirst({
      where: { id, customerId, deletedAt: null },
      include: {
        provider: { select: { name: true, slug: true } },
        node: { select: { name: true, status: true } },
        region: { select: { name: true, code: true } },
        image: { select: { name: true, version: true, osFamily: true } },
        addresses: { select: { family: true, address: true, isPrimary: true } },
      },
    });
    if (!i) throw new NotFoundException("Instance not found");
    return {
      id: i.id, name: i.name, kind: i.kind.toLowerCase(), status: i.status.toLowerCase(),
      provider: { name: i.provider.name, slug: i.provider.slug.toLowerCase() },
      node: i.node, region: i.region, image: i.image, addresses: i.addresses,
      vcpu: i.vcpu, memoryMb: i.memoryMb, diskGb: i.diskGb, createdAt: i.createdAt,
      mode: typeof i.metadata === "object" && i.metadata !== null && !Array.isArray(i.metadata) && i.metadata["mode"] === "MOCK" ? "mock" : "real",
    };
  }

  private async queue(request: Request, id: string, action: LifecycleAction) {
    const actor = await this.actor(request);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Invalid instance ID");
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM instances
        WHERE id = ${id} AND customer_id = ${actor.customerId} AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException("Instance not found");
      const i = await tx.instance.findFirst({
        where: { id, customerId: actor.customerId, deletedAt: null },
        include: { provider: true, node: true },
      });
      if (!i) throw new NotFoundException("Instance not found");
      const nodeMeta = i.node.metadata, instanceMeta = i.metadata;
      const realNode = typeof nodeMeta === "object" && nodeMeta !== null && !Array.isArray(nodeMeta)
        && nodeMeta["mode"] === "REAL" && nodeMeta["testNode"] === true;
      const realInstance = typeof instanceMeta === "object" && instanceMeta !== null && !Array.isArray(instanceMeta)
        && instanceMeta["mode"] === "REAL" && instanceMeta["testFixture"] === true;
      const realEnabled = process.env.INCUS_API_REAL_ENABLED === "true"
        && i.nodeId === "incus-test-node-01" && realNode && realInstance
        && i.kind === "CONTAINER" && Boolean(i.externalId);
      const provisionedReal = typeof nodeMeta === "object" && nodeMeta !== null && !Array.isArray(nodeMeta)
        && nodeMeta["mode"] === "REAL"
        && typeof instanceMeta === "object" && instanceMeta !== null && !Array.isArray(instanceMeta)
        && instanceMeta["mode"] === "REAL" && instanceMeta["provisioning"] === "INCUS"
        && Boolean(i.externalId) && i.kind === "CONTAINER"
        && i.node.lastSeenAt !== null && i.node.lastSeenAt.getTime() >= Date.now() - 180000;
      const mode = (realEnabled || provisionedReal) ? "REAL" : null;
      if (!mode || i.provider.slug !== "INCUS" || i.node.status !== "ONLINE") {
        throw new ConflictException("This VPS currently has no enabled hypervisor control driver");
      }
      const allowed = (action === "START" && i.status === "STOPPED")
        || (action === "STOP" && i.status === "RUNNING")
        || (action === "REBOOT" && i.status === "RUNNING");
      if (!allowed) throw new ConflictException(`Cannot ${action.toLowerCase()} instance in ${i.status} state`);
      const active = await tx.task.findFirst({
        where: { instanceId: id, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true },
      });
      if (active) throw new ConflictException("Another operation is already in progress");
      const task = await tx.task.create({
        data: { instanceId: id, type: action, status: "QUEUED", payload: { mode, action, requestedBy: actor.userId }, maxAttempts: 1 },
        select: { id: true, type: true, status: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: { userId: actor.userId, action: `CUSTOMER_INSTANCE_${action}_QUEUED`, entityType: "INSTANCE", entityId: id, metadata: { taskId: task.id, mode } },
      });
      return { accepted: true, instanceId: id, task: { ...task, type: task.type.toLowerCase(), status: task.status.toLowerCase() } };
    });
  }

  @Post(":id/start") start(@Req() request: Request, @Param("id") id: string) { return this.queue(request, id, "START"); }
  @Post(":id/stop") stop(@Req() request: Request, @Param("id") id: string) { return this.queue(request, id, "STOP"); }
  @Post(":id/reboot") reboot(@Req() request: Request, @Param("id") id: string) { return this.queue(request, id, "REBOOT"); }

  @Post(":id/password")
  async password(@Req() request: Request, @Param("id") id: string) {
    const actor = await this.actor(request);
    const hash = request.body?.passwordHash;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || typeof hash !== "string" || !/^\$6\$[A-Za-z0-9./]{1,16}\$[A-Za-z0-9./]{86}$/.test(hash)) throw new BadRequestException("Invalid password reset request");
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id=${id} AND customer_id=${actor.customerId} FOR UPDATE`;
      const i=await tx.instance.findUnique({where:{id},include:{node:true,provider:true}});
      if (!i || i.deletedAt || i.customerId !== actor.customerId) throw new NotFoundException("Instance not found");
      const m=i.metadata;
      if (i.status!=="RUNNING" || i.kind!=="CONTAINER" || i.provider.slug!=="INCUS" || !i.externalId?.startsWith("kh-") || !m || typeof m!=="object" || Array.isArray(m) || m.mode!=="REAL" || m.provisioning!=="INCUS" || i.node.status!=="ONLINE" || !i.node.lastSeenAt || Date.now()-i.node.lastSeenAt.getTime()>180000) throw new ConflictException("Password reset requires a running managed Incus container");
      if (await tx.task.findFirst({where:{instanceId:id,status:{in:["QUEUED","RUNNING"]}}})) throw new ConflictException("Instance already has an active task");
      const task=await tx.task.create({data:{instanceId:id,type:"CHANGE_PASSWORD",status:"QUEUED",maxAttempts:1,payload:{mode:"REAL",passwordHash:hash}},select:{id:true,status:true}});
      await tx.auditLog.create({data:{userId:actor.userId,action:"CUSTOMER_INSTANCE_CHANGE_PASSWORD_QUEUED",entityType:"INSTANCE",entityId:id,metadata:{taskId:task.id}}});
      return {accepted:true,task};
    });
  }

  @Get(":id/tasks")
  async tasks(@Req() request: Request, @Param("id") id: string) {
    const { customerId } = await this.actor(request);
    const i = await this.prisma.instance.findFirst({ where: { id, customerId, deletedAt: null }, select: { id: true } });
    if (!i) throw new NotFoundException("Instance not found");
    const rows = await this.prisma.task.findMany({
      where: { instanceId: id }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, type: true, status: true, attempts: true, lastError: true, createdAt: true, startedAt: true, finishedAt: true },
    });
    return rows.map((t) => ({ ...t, type: t.type.toLowerCase(), status: t.status.toLowerCase() }));
  }

  @Get(":id/events")
  async events(@Req() request: Request, @Param("id") id: string) {
    const { customerId } = await this.actor(request);
    const i = await this.prisma.instance.findFirst({ where: { id, customerId, deletedAt: null }, select: { id: true } });
    if (!i) throw new NotFoundException("Instance not found");
    return this.prisma.instanceEvent.findMany({
      where: { instanceId: id }, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, eventType: true, payload: true, createdAt: true },
    });
  }
}

@Module({ imports: [AuthModule], controllers: [CustomerInstancesController] })
export class CustomerInstancesModule {}
