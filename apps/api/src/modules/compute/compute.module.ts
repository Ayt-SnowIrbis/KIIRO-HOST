import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
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

      const mockNode =
        typeof nodeMetadata === "object" &&
        nodeMetadata !== null &&
        !Array.isArray(nodeMetadata) &&
        nodeMetadata["mode"] === "MOCK" &&
        nodeMetadata["networkEnabled"] === false;

      const mockInstance =
        typeof instanceMetadata === "object" &&
        instanceMetadata !== null &&
        !Array.isArray(instanceMetadata) &&
        instanceMetadata["mode"] === "MOCK";

      if (
        !mockNode ||
        !mockInstance ||
        instance.provider.slug !== "INCUS" ||
        instance.node.status !== "ONLINE"
      ) {
        throw new BadRequestException(
          "Only online Mock Incus instances are supported",
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
            mode: "MOCK",
            action,
          },
          maxAttempts: 5,
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
          metadata: { taskId: task.id, mode: "MOCK" },
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

  @Post(":id/resize")
  async resize(@Req() request: Request, @Param("id") id: string, @Body() raw: unknown) {
    const adminSession = await this.requireAdmin(request);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new BadRequestException("Invalid instance ID");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("JSON object required");
    const body = raw as Record<string, unknown>;
    const allowed = ["vcpu", "memoryMb", "diskGb"];
    if (Object.keys(body).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in body))) {
      throw new BadRequestException("Supply vcpu, memoryMb and diskGb only");
    }
    const positiveInt = (value: unknown, field: string, max: number) => {
      if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) {
        throw new BadRequestException(`Invalid ${field}`);
      }
      return Number(value);
    };
    const target = {
      vcpu: positiveInt(body.vcpu, "vcpu", 256),
      memoryMb: positiveInt(body.memoryMb, "memoryMb", 1_048_576),
      diskGb: positiveInt(body.diskGb, "diskGb", 100_000),
    };

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM instances WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
      `;
      if (!locked.length) throw new NotFoundException("Instance not found");
      const instance = await tx.instance.findUnique({ where: { id }, include: { node: true, provider: true } });
      if (!instance) throw new NotFoundException("Instance not found");
      const nodeMeta = instance.node.metadata;
      const instanceMeta = instance.metadata;
      const mockNode = typeof nodeMeta === "object" && nodeMeta !== null && !Array.isArray(nodeMeta)
        && nodeMeta["mode"] === "MOCK" && nodeMeta["networkEnabled"] === false;
      const mockInstance = typeof instanceMeta === "object" && instanceMeta !== null && !Array.isArray(instanceMeta)
        && instanceMeta["mode"] === "MOCK";
      if (!mockNode || !mockInstance || instance.provider.slug !== "INCUS" || instance.node.status !== "ONLINE") {
        throw new BadRequestException("Resize is available only for online Mock Incus instances until a real provider driver is configured");
      }
      if (instance.status !== "RUNNING" && instance.status !== "STOPPED") {
        throw new ConflictException(`Cannot resize instance in ${instance.status} state`);
      }
      if (target.diskGb < instance.diskGb) throw new BadRequestException("Disk shrink is not supported");
      if (target.vcpu === instance.vcpu && target.memoryMb === instance.memoryMb && target.diskGb === instance.diskGb) {
        throw new BadRequestException("Requested resources match the current configuration");
      }
      const pending = await tx.task.findFirst({
        where: { instanceId: id, status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true },
      });
      if (pending) throw new ConflictException("Instance already has an active task");
      const task = await tx.task.create({
        data: {
          instanceId: id, type: "RESIZE", status: "QUEUED",
          payload: { mode: "MOCK", action: "RESIZE", target, requestedBy: adminSession.userId },
          maxAttempts: 1,
        },
        select: { id: true, type: true, status: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          userId: adminSession.userId, action: "INSTANCE_RESIZE_QUEUED",
          entityType: "INSTANCE", entityId: id,
          metadata: { taskId: task.id, mode: "MOCK", before: { vcpu: instance.vcpu, memoryMb: instance.memoryMb, diskGb: instance.diskGb }, target },
        },
      });
      return { accepted: true, instanceId: id, task: { ...task, type: task.type.toLowerCase(), status: task.status.toLowerCase() } };
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
