import { issueConsoleTicket } from "./console-ticket";
import { consoleAvailability } from "./console-policy";
import { listManagedSshKeys, queueSshKey } from "./ssh-keys";
import { Header } from "@nestjs/common";
import { generateRootCredential } from "./ssh-password";
import {
  Controller,
  Get,
  Post,
  Param,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Module,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../database/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";

@Controller("compute/instances")
class ComputeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  private async requireAdmin(request: Request) {
    const cookie = (request.headers.cookie ?? "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("kiiro_session="));

    const token = cookie?.slice("kiiro_session=".length);

    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
      throw new UnauthorizedException("Authentication required");
    }

    const session = await this.sessions.validate(token);

    if (!session) {
      throw new UnauthorizedException("Invalid session");
    }

    if (session.user.role !== "admin") {
      throw new ForbiddenException("Administrator required");
    }

    return session;
  }

  @Get()
  async list(@Req() request: Request) {
    await this.requireAdmin(request);

    const instances = await this.prisma.instance.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        provider: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
        node: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        region: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        addresses: {
          select: {
            family: true,
            address: true,
            isPrimary: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return instances.map((instance) => ({
      id: instance.id,
      name: instance.name,
      kind: instance.kind.toLowerCase(),
      status: instance.status.toLowerCase(),
      mode: typeof instance.metadata === "object" && instance.metadata !== null && !Array.isArray(instance.metadata) && instance.metadata["mode"] === "MOCK" ? "mock" : "real",
      provider: {
        ...instance.provider,
        slug: instance.provider.slug.toLowerCase(),
      },
      node: instance.node,
      region: instance.region,
      addresses: instance.addresses,
      vcpu: instance.vcpu,
      memoryMb: instance.memoryMb,
      diskGb: instance.diskGb,
      createdAt: instance.createdAt,
    }));
  }

  private async queueAction(
    request: Request,
    id: string,
    action: "START" | "STOP" | "REBOOT",
  ) {
    const adminSession = await this.requireAdmin(request);

    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      throw new BadRequestException("Invalid instance ID");
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock the instance row so concurrent API requests cannot
      // enqueue conflicting operations.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM instances
        WHERE id = ${id}
          AND deleted_at IS NULL
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new NotFoundException("Instance not found");
      }

      const instance = await tx.instance.findUnique({
        where: { id },
        include: {
          node: true,
          provider: true,
        },
      });

      if (!instance) {
        throw new NotFoundException("Instance not found");
      }

      const nodeMetadata = instance.node.metadata;
      const instanceMetadata = instance.metadata;

      const realNode = typeof nodeMetadata === "object" && nodeMetadata !== null
        && !Array.isArray(nodeMetadata) && nodeMetadata["mode"] === "REAL" && nodeMetadata["testNode"] === true;
      const realInstance = typeof instanceMetadata === "object" && instanceMetadata !== null
        && !Array.isArray(instanceMetadata) && instanceMetadata["mode"] === "REAL" && instanceMetadata["testFixture"] === true;
      const realEnabled = process.env.INCUS_API_REAL_ENABLED === "true"
        && instance.nodeId === "incus-test-node-01" && realNode && realInstance
        && instance.kind === "CONTAINER" && Boolean(instance.externalId);
      const provisionedReal = typeof nodeMetadata === "object" && nodeMetadata !== null && !Array.isArray(nodeMetadata)
        && nodeMetadata["mode"] === "REAL"
        && typeof instanceMetadata === "object" && instanceMetadata !== null && !Array.isArray(instanceMetadata)
        && instanceMetadata["mode"] === "REAL" && instanceMetadata["provisioning"] === "INCUS"
        && Boolean(instance.externalId) && instance.kind === "CONTAINER"
        && instance.node.lastSeenAt !== null && instance.node.lastSeenAt.getTime() >= Date.now() - 180000;
      const mode = (realEnabled || provisionedReal) ? "REAL" : null;
      if (!mode || instance.provider.slug !== "INCUS" || instance.node.status !== "ONLINE") {
        throw new BadRequestException(
          "No enabled Incus lifecycle driver for this instance",
        );
      }

      const allowed =
        (action === "START" && instance.status === "STOPPED") ||
        (action === "STOP" && instance.status === "RUNNING") ||
        (action === "REBOOT" && instance.status === "RUNNING");

      if (!allowed) {
        throw new ConflictException(
          `Cannot ${action.toLowerCase()} instance in ${instance.status} state`,
        );
      }

      const pending = await tx.task.findFirst({
        where: {
          instanceId: id,
          status: { in: ["QUEUED", "RUNNING"] },
        },
        select: { id: true },
      });

      if (pending) {
        throw new ConflictException(
          "Instance already has an active task",
        );
      }

      const task = await tx.task.create({
        data: {
          instanceId: id,
          type: action,
          status: "QUEUED",
          payload: {
            mode,
            action,
          },
          maxAttempts: 1,
        },
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: adminSession.userId,
          action: `INSTANCE_${action}_QUEUED`,
          entityType: "INSTANCE",
          entityId: id,
          metadata: { taskId: task.id, mode },
        },
      });

      return {
        accepted: true,
        instanceId: id,
        task: {
          ...task,
          type: task.type.toLowerCase(),
          status: task.status.toLowerCase(),
        },
      };
    });
  }

  @Post(":id/start")
  start(@Req() request: Request, @Param("id") id: string) {
    return this.queueAction(request, id, "START");
  }

  @Post(":id/stop")
  stop(@Req() request: Request, @Param("id") id: string) {
    return this.queueAction(request, id, "STOP");
  }

  @Post(":id/reboot")
  reboot(@Req() request: Request, @Param("id") id: string) {
    return this.queueAction(request, id, "REBOOT");
  }

  /** Read-only, actor-authorized capability. No console ticket or guest command. */
  @Post(":id/console/ticket")
  async issueConsoleTicket(@Req() request: Request, @Param("id") id: string) {
    const session = await this.requireAdmin(request);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Invalid instance ID");
    const instance = await this.prisma.instance.findFirst({
      where: { id, deletedAt: null },
      include: { node: true, provider: true },
    });
    if (!instance) throw new NotFoundException("Instance not found");
    const active = await this.prisma.task.findFirst({ where: { instanceId: id, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } });
    if (!consoleAvailability(instance, Boolean(active)).available || !instance.externalId)
      throw new ConflictException("Console unavailable");
    return issueConsoleTicket({
      sessionId: session.sessionId, userId: session.userId, role: "admin",
      instanceId: instance.id, nodeId: instance.nodeId, externalName: instance.externalId,
    }, request);
  }

  @Get(":id/console/availability")
  async consoleAvailability(@Req() request: Request, @Param("id") id: string) {
    await this.requireAdmin(request);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Invalid instance ID");
    const instance = await this.prisma.instance.findFirst({
      where: { id, deletedAt: null },
      include: { node: true, provider: true },
    });
    if (!instance) throw new NotFoundException("Instance not found");
    const active = await this.prisma.task.findFirst({
      where: { instanceId: id, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    });
    return { ...consoleAvailability(instance, Boolean(active)), enabled: false };
  }

  @Get(":id/events")
  async events(@Req() request: Request, @Param("id") id: string) {
    await this.requireAdmin(request);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Invalid instance ID");
    const instance = await this.prisma.instance.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!instance) throw new NotFoundException("Instance not found");
    return this.prisma.instanceEvent.findMany({
      where: { instanceId: id }, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, eventType: true, payload: true, createdAt: true },
    });
  }

  @Get(":id/ssh-keys")
  async sshKeys(@Req() request: Request, @Param("id") id: string) {
    const actor=await this.requireAdmin(request);
    return listManagedSshKeys(this.prisma,id);
  }

  @Post(":id/ssh-keys")
  async addSshKey(@Req() request: Request, @Param("id") id: string) {
    const actor=await this.requireAdmin(request);
    return queueSshKey(this.prisma,id,actor.userId,"add",request.body?.publicKey);
  }

  @Post(":id/ssh-keys/remove")
  async removeSshKey(@Req() request: Request, @Param("id") id: string) {
    const actor=await this.requireAdmin(request);
    return queueSshKey(this.prisma,id,actor.userId,"remove",request.body?.publicKey);
  }

  @Header("Cache-Control", "no-store")
  @Post(":id/password")
  async password(@Req() request: Request, @Param("id") id: string) {
    const admin = await this.requireAdmin(request);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Invalid instance ID");
    const {password, hash} = generateRootCredential();
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM instances WHERE id=${id} FOR UPDATE`;
      const i=await tx.instance.findUnique({where:{id},include:{node:true,provider:true}});
      if (!i || i.deletedAt) throw new NotFoundException("Instance not found");
      const m=i.metadata;
      if (i.status!=="RUNNING" || i.kind!=="CONTAINER" || i.provider.slug!=="INCUS" || !i.externalId?.startsWith("kh-") || !m || typeof m!=="object" || Array.isArray(m) || m.mode!=="REAL" || m.provisioning!=="INCUS" || i.node.status!=="ONLINE" || !i.node.lastSeenAt || Date.now()-i.node.lastSeenAt.getTime()>180000) throw new ConflictException("Password reset requires a running managed Incus container");
      if (await tx.task.findFirst({where:{instanceId:id,status:{in:["QUEUED","RUNNING"]}}})) throw new ConflictException("Instance already has an active task");
      const task=await tx.task.create({data:{instanceId:id,type:"CHANGE_PASSWORD",status:"QUEUED",maxAttempts:1,payload:{mode:"REAL",passwordHash:hash}},select:{id:true,status:true}});
      await tx.auditLog.create({data:{userId:admin.userId,action:"INSTANCE_CHANGE_PASSWORD_QUEUED",entityType:"INSTANCE",entityId:id,metadata:{taskId:task.id}}});
      return {accepted:true,task,password};
    });
  }

  @Post(":id/resize")
  async resize(@Req() request: Request, @Param("id") id: string) {
    const admin = await this.requireAdmin(request);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Invalid instance ID");
    const { vcpu, memoryMb, diskGb } = request.body ?? {};
    if (![vcpu,memoryMb,diskGb].every(v=>Number.isSafeInteger(v)&&v>0) || vcpu>256 || memoryMb>1048576 || memoryMb%1024!==0 || diskGb>100000) throw new BadRequestException("Invalid resize resources");
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM instances WHERE id=${id} FOR UPDATE`;
      const i=await tx.instance.findUnique({where:{id},include:{node:true,provider:true}});
      if(!i || i.deletedAt) throw new NotFoundException("Instance not found");
      const m=i.metadata;
      if(i.status!=="STOPPED" || i.kind!=="CONTAINER" || i.provider.slug!=="INCUS" || !i.externalId || !m || typeof m!=="object" || Array.isArray(m) || m.mode!=="REAL" || m.provisioning!=="INCUS" || i.node.status!=="ONLINE" || !i.node.lastSeenAt || Date.now()-i.node.lastSeenAt.getTime()>180000) throw new ConflictException("Resize requires a stopped managed Incus container on an online node");
      if(m.resizeUncertain === true || !i.externalId.startsWith("kh-")) throw new ConflictException("Instance requires reconciliation");
      const nm=i.node.metadata;
      if(!nm || typeof nm!=="object" || Array.isArray(nm) || nm.mode!=="REAL") throw new ConflictException("Node is not managed");
      if(diskGb<i.diskGb) throw new BadRequestException("Disk shrink is forbidden");
      if(await tx.task.findFirst({where:{instanceId:id,status:{in:["QUEUED","RUNNING"]}}})) throw new ConflictException("Instance already has an active task");
      await tx.$queryRaw`SELECT id FROM nodes WHERE id=${i.nodeId} FOR UPDATE`;
      const n=await tx.node.findUniqueOrThrow({where:{id:i.nodeId}});
      const cpu=Math.max(0,vcpu-i.vcpu), ram=Math.max(0,memoryMb-i.memoryMb), disk=Math.max(0,diskGb-i.diskGb);
      if(n.reservedVcpu+cpu>n.totalVcpu || n.reservedMemoryMb+BigInt(ram)>n.totalMemoryMb || n.reservedDiskGb+BigInt(disk)>n.totalDiskGb) throw new ConflictException("Insufficient node capacity");
      await tx.node.update({where:{id:n.id},data:{reservedVcpu:{increment:cpu},reservedMemoryMb:{increment:BigInt(ram)},reservedDiskGb:{increment:BigInt(disk)}}});
      const task=await tx.task.create({data:{instanceId:id,type:"RESIZE",status:"QUEUED",maxAttempts:1,payload:{mode:"REAL",vcpu,memoryMb,diskGb,oldVcpu:i.vcpu,oldMemoryMb:i.memoryMb,oldDiskGb:i.diskGb}}});
      await tx.auditLog.create({data:{userId:admin.userId,action:"INSTANCE_RESIZE_QUEUED",entityType:"INSTANCE",entityId:id,metadata:{taskId:task.id,vcpu,memoryMb,diskGb}}});
      return {accepted:true,instanceId:id,task:{id:task.id,type:"resize",status:"queued",createdAt:task.createdAt}};
    });
  }

  @Get(":id/tasks")
  async tasks(@Req() request: Request, @Param("id") id: string) {
    await this.requireAdmin(request);

    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      throw new BadRequestException("Invalid instance ID");
    }

    const instance = await this.prisma.instance.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (!instance) {
      throw new NotFoundException("Instance not found");
    }

    const tasks = await this.prisma.task.findMany({
      where: { instanceId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    return tasks.map((task) => ({
      ...task,
      type: task.type.toLowerCase(),
      status: task.status.toLowerCase(),
    }));
  }

}

@Module({
  imports: [AuthModule],
  controllers: [ComputeController],
})
export class ComputeModule {}
