import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Module,
  NotFoundException, Param, Patch, Post, Req, UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";
import { PrismaService } from "../database/prisma.module";

type AdminActor = { userId: string };

@Controller("compute/admin")
class AdminWriteController {
  constructor(private readonly prisma: PrismaService, private readonly sessions: SessionService) {}

  private async authorize(request: Request): Promise<AdminActor> {
    const token = (request.headers.cookie ?? "").split(";").map((s) => s.trim())
      .find((s) => s.startsWith("kiiro_session="))?.slice("kiiro_session=".length);
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();
    if (session.user.role !== "admin") throw new ForbiddenException();
    return { userId: session.userId };
  }

  private object(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestException("JSON object required");
    return body as Record<string, unknown>;
  }
  private string(value: unknown, field: string, max = 120): string {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequestException(`Invalid ${field}`);
    return value.trim();
  }
  private enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) throw new BadRequestException(`Invalid ${field}`);
    return value as T;
  }
  private async audit(actor: AdminActor, action: string, entityType: string, entityId: string, metadata: object = {}) {
    await this.prisma.auditLog.create({ data: { userId: actor.userId, action, entityType, entityId, metadata } });
  }

  @Patch("users/:id")
  async updateUser(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const actor = await this.authorize(req), body = this.object(raw);
    if (id === actor.userId && (body.role === "USER" || (body.status !== undefined && body.status !== "ACTIVE"))) {
      throw new BadRequestException("You cannot demote or suspend your own active administrator account");
    }
    const data: { role?: "USER" | "ADMIN"; status?: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" } = {};
    if ("role" in body) data.role = this.enumValue(body.role, ["USER", "ADMIN"] as const, "role");
    if ("status" in body) data.status = this.enumValue(body.status, ["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED"] as const, "status");
    if (!Object.keys(data).length) throw new BadRequestException("No supported fields supplied");
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
      if (!before) throw new NotFoundException("User not found");
      const updated = await tx.user.update({ where: { id }, data, select: { id: true, email: true, role: true, status: true } });
      await tx.auditLog.create({ data: { userId: actor.userId, action: "USER_UPDATED", entityType: "USER", entityId: id, metadata: { before, after: updated } } });
      return updated;
    });
    return result;
  }

  @Patch("nodes/:id")
  async updateNode(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const actor = await this.authorize(req), body = this.object(raw);
    const data: Record<string, unknown> = {};
    if ("name" in body) data.name = this.string(body.name, "name");
    if ("status" in body) data.status = this.enumValue(body.status, ["ONLINE", "DEGRADED", "MAINTENANCE", "OFFLINE"] as const, "status");
    for (const field of ["totalVcpu", "reservedVcpu"] as const) {
      if (field in body) {
        const value = body[field];
        if (!Number.isSafeInteger(value) || Number(value) < 0) throw new BadRequestException(`Invalid ${field}`);
        data[field] = value;
      }
    }
    for (const field of ["totalMemoryMb", "reservedMemoryMb", "totalDiskGb", "reservedDiskGb"] as const) {
      if (field in body) {
        const value = body[field];
        if (!(typeof value === "string" && /^\\d+$/.test(value)) && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) throw new BadRequestException(`Invalid ${field}`);
        data[field] = BigInt(value);
      }
    }
    if (!Object.keys(data).length) throw new BadRequestException("No supported fields supplied");
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.node.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
      if (!before) throw new NotFoundException("Node not found");
      const updated = await tx.node.update({ where: { id }, data, select: { id: true, name: true, status: true, totalVcpu: true, reservedVcpu: true } });
      await tx.auditLog.create({ data: { userId: actor.userId, action: "NODE_UPDATED", entityType: "NODE", entityId: id, metadata: { before, after: updated } } });
      return updated;
    });
  }

  @Patch("regions/:id")
  async updateRegion(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const actor = await this.authorize(req), body = this.object(raw), data: Record<string, unknown> = {};
    if ("name" in body) data.name = this.string(body.name, "name");
    if ("code" in body) data.code = this.string(body.code, "code", 16).toUpperCase();
    if ("country" in body) data.country = this.string(body.country, "country", 2).toUpperCase();
    if ("enabled" in body) { if (typeof body.enabled !== "boolean") throw new BadRequestException("Invalid enabled"); data.enabled = body.enabled; }
    if (!Object.keys(data).length) throw new BadRequestException("No supported fields supplied");
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.region.findUnique({ where: { id }, select: { id: true, code: true, name: true, enabled: true } });
      if (!before) throw new NotFoundException("Region not found");
      const updated = await tx.region.update({ where: { id }, data, select: { id: true, code: true, name: true, country: true, enabled: true } });
      await tx.auditLog.create({ data: { userId: actor.userId, action: "REGION_UPDATED", entityType: "REGION", entityId: id, metadata: { before, after: updated } } });
      return updated;
    });
  }

  @Patch("plans/:id")
  async updatePlan(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const actor = await this.authorize(req), body = this.object(raw), data: Record<string, unknown> = {};
    if ("name" in body) data.name = this.string(body.name, "name", 160);
    if ("description" in body) { if (body.description !== null && typeof body.description !== "string") throw new BadRequestException("Invalid description"); data.description = body.description; }
    for (const field of ["vcpu", "memoryMb", "diskGb", "sortOrder"] as const) {
      if (field in body) { const n = body[field]; if (!Number.isSafeInteger(n) || Number(n) < (field === "sortOrder" ? -10000 : 1)) throw new BadRequestException(`Invalid ${field}`); data[field] = n; }
    }
    if ("enabled" in body) { if (typeof body.enabled !== "boolean") throw new BadRequestException("Invalid enabled"); data.enabled = body.enabled; }
    if (!Object.keys(data).length) throw new BadRequestException("No supported fields supplied");
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.plan.findUnique({ where: { id }, select: { id: true, name: true, enabled: true } });
      if (!before) throw new NotFoundException("Plan not found");
      const updated = await tx.plan.update({ where: { id }, data, select: { id: true, slug: true, name: true, enabled: true, vcpu: true, memoryMb: true, diskGb: true } });
      await tx.auditLog.create({ data: { userId: actor.userId, action: "PLAN_UPDATED", entityType: "PLAN", entityId: id, metadata: { before, after: updated } } });
      return updated;
    });
  }

  @Patch("images/:id")
  async updateImage(@Req() req: Request, @Param("id") id: string, @Body() raw: unknown) {
    const actor = await this.authorize(req), body = this.object(raw), data: Record<string, unknown> = {};
    if ("name" in body) data.name = this.string(body.name, "name", 160);
    if ("enabled" in body) { if (typeof body.enabled !== "boolean") throw new BadRequestException("Invalid enabled"); data.enabled = body.enabled; }
    if (!Object.keys(data).length) throw new BadRequestException("No supported fields supplied");
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.osImage.findUnique({ where: { id }, select: { id: true, name: true, enabled: true } });
      if (!before) throw new NotFoundException("Image not found");
      const updated = await tx.osImage.update({ where: { id }, data, select: { id: true, slug: true, name: true, version: true, enabled: true } });
      await tx.auditLog.create({ data: { userId: actor.userId, action: "IMAGE_UPDATED", entityType: "OS_IMAGE", entityId: id, metadata: { before, after: updated } } });
      return updated;
    });
  }
}

@Module({ imports: [AuthModule], controllers: [AdminWriteController] })
export class AdminWriteModule {}
