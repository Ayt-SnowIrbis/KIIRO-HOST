import https from "node:https";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { Controller, Get, Module, Req, UnauthorizedException, ForbiddenException, Param, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../database/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";

@Controller("compute/admin")
class AdminReadController {
  constructor(private readonly prisma: PrismaService, private readonly sessions: SessionService) {}

  private async authorize(request: Request) {
    const token = (request.headers.cookie ?? "").split(";").map((s) => s.trim())
      .find((s) => s.startsWith("kiiro_session="))?.slice("kiiro_session=".length);
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();
    if (session.user.role !== "admin") throw new ForbiddenException();
    return session;
  }

  @Get("overview")
  async overview(@Req() request: Request) {
    await this.authorize(request);
    const [users, instances, nodes, onlineNodes, queuedTasks, runningInstances, recentTasks] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.instance.count({ where: { deletedAt: null } }),
      this.prisma.node.count(),
      this.prisma.node.count({ where: { status: "ONLINE" } }),
      this.prisma.task.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
      this.prisma.instance.count({ where: { status: "RUNNING", deletedAt: null } }),
      this.prisma.task.findMany({ take: 8, orderBy: { createdAt: "desc" }, select: {
        id: true, type: true, status: true, instanceId: true, createdAt: true,
      } }),
    ]);
    return { users, instances, nodes, onlineNodes, queuedTasks, runningInstances, recentTasks };
  }

  @Get("users")
  async users(@Req() request: Request) {
    await this.authorize(request);
    return this.prisma.user.findMany({ take: 100, orderBy: { createdAt: "desc" }, select: {
      id: true, email: true, role: true, status: true, emailVerifiedAt: true,
      lastLoginAt: true, createdAt: true,
      customer: { select: { id: true, displayName: true, countryCode: true } },
    } });
  }

  @Get("nodes")
  async nodes(@Req() request: Request) {
    await this.authorize(request);
    const nodes = await this.prisma.node.findMany({ take: 100, orderBy: { name: "asc" }, select: {
      id: true, name: true, status: true, totalVcpu: true, reservedVcpu: true,
      totalMemoryMb: true, reservedMemoryMb: true, totalDiskGb: true,
      reservedDiskGb: true, lastSeenAt: true, metadata: true,
      provider: { select: { name: true, slug: true } },
      region: { select: { name: true, code: true } },
    } });
    return nodes.map(({ metadata, ...node }) => ({
      ...node,
      totalMemoryMb: node.totalMemoryMb.toString(),
      reservedMemoryMb: node.reservedMemoryMb.toString(),
      totalDiskGb: node.totalDiskGb.toString(),
      reservedDiskGb: node.reservedDiskGb.toString(),
      mode: typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) && metadata["mode"] === "MOCK" ? "MOCK" : "REAL",
    }));
  }


  @Get("nodes/:id/connectivity")
  async nodeConnectivity(@Req() request: Request, @Param("id") id: string) {
    await this.authorize(request);
    const node = await this.prisma.node.findUnique({
      where: { id }, select: { id: true, metadata: true, provider: { select: { slug: true } } },
    });
    if (!node) throw new NotFoundException("Node not found");
    const checkedAt = new Date().toISOString();
    const meta = node.metadata;
    const eligible = id === "incus-test-node-01" && node.provider.slug === "INCUS"
      && typeof meta === "object" && meta !== null && !Array.isArray(meta)
      && meta["mode"] === "REAL" && meta["testNode"] === true;
    if (!eligible || process.env.INCUS_ADMIN_PROBE_ENABLED !== "true") {
      return { state: "NOT_CONFIGURED", checkedAt };
    }
    try {
      const url = new URL(process.env.INCUS_API_URL ?? "");
      if (url.protocol !== "https:" || url.hostname !== "incus-01-test" || url.port !== "8443"
        || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Invalid configured endpoint");
      }
      const ca = readFileSync(process.env.INCUS_SERVER_CERT_PATH ?? "");
      const fingerprint = new X509Certificate(ca).fingerprint256.replaceAll(":", "").toLowerCase();
      if (fingerprint !== (process.env.INCUS_SERVER_FINGERPRINT ?? "").replaceAll(":", "").toLowerCase()) {
        throw new Error("Certificate pin mismatch");
      }
      const agent = new https.Agent({
        cert: readFileSync(process.env.INCUS_CLIENT_CERT_PATH ?? ""),
        key: readFileSync(process.env.INCUS_CLIENT_KEY_PATH ?? ""),
        ca, rejectUnauthorized: true,
        checkServerIdentity: (_host, cert) => cert.fingerprint256?.replaceAll(":", "").toLowerCase() === fingerprint
          ? undefined : new Error("Server identity mismatch"),
      });
      const reachable = await new Promise<boolean>((resolve) => {
        const req = https.get(new URL("/1.0", url), { agent, timeout: 5000, headers: { Accept: "application/json" } }, (res) => {
          const ok = res.statusCode === 200;
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) req.destroy();
            else chunks.push(chunk);
          });
          res.on("end", () => {
            if (!ok || size > 65536) return resolve(false);
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { type?: string; metadata?: { auth?: string } };
              resolve(body.type === "sync" && body.metadata?.auth === "trusted");
            } catch { resolve(false); }
          });
          res.on("error", () => resolve(false));
        });
        req.on("timeout", () => req.destroy());
        req.on("error", () => resolve(false));
      });
      return { state: reachable ? "REACHABLE" : "UNREACHABLE", checkedAt };
    } catch {
      return { state: "UNREACHABLE", checkedAt };
    }
  }

  @Get("regions")
  async regions(@Req() request: Request) {
    await this.authorize(request);
    return this.prisma.region.findMany({ take: 100, orderBy: { name: "asc" }, select: {
      id: true, code: true, name: true, country: true, enabled: true,
      _count: { select: { nodes: true, instances: true } },
    } });
  }

  @Get("plans")
  async plans(@Req() request: Request) {
    await this.authorize(request);
    const plans = await this.prisma.plan.findMany({ take: 100, orderBy: { sortOrder: "asc" }, select: {
      id: true, slug: true, name: true, enabled: true, vcpu: true, memoryMb: true, diskGb: true,
      prices: { select: { currency: true, amountMinor: true, billingModel: true, active: true } },
    } });
    return plans.map((plan) => ({
      ...plan, prices: plan.prices.map((price) => ({ ...price, amountMinor: price.amountMinor.toString() })),
    }));
  }

  @Get("images")
  async images(@Req() request: Request) {
    await this.authorize(request);
    const images = await this.prisma.osImage.findMany({ take: 100, orderBy: { name: "asc" }, select: {
      id: true, slug: true, name: true, version: true, osFamily: true,
      enabled: true, metadata: true, provider: { select: { name: true } },
    } });
    return images.map(({ metadata, ...image }) => ({
      ...image,
      mode: typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) && metadata["mode"] === "MOCK" ? "MOCK" : "REAL",
    }));
  }

  @Get("tasks")
  async tasks(@Req() request: Request) {
    await this.authorize(request);
    return this.prisma.task.findMany({ take: 100, orderBy: { createdAt: "desc" }, select: {
      id: true, instanceId: true, type: true, status: true, attempts: true,
      createdAt: true, startedAt: true, finishedAt: true, lastError: true,
    } });
  }

  @Get("audit")
  async audit(@Req() request: Request) {
    await this.authorize(request);
    return this.prisma.auditLog.findMany({ take: 100, orderBy: { createdAt: "desc" }, select: {
      id: true, action: true, entityType: true, entityId: true, createdAt: true,
      user: { select: { email: true } },
    } });
  }

  @Get("billing")
  async billing(@Req() request: Request) {
    await this.authorize(request);
    const [orders, invoices] = await Promise.all([
      this.prisma.order.findMany({ take: 50, orderBy: { createdAt: "desc" }, select: {
        id: true, status: true, currency: true, totalMinor: true, createdAt: true,
      } }),
      this.prisma.invoice.findMany({ take: 50, orderBy: { createdAt: "desc" }, select: {
        id: true, number: true, status: true, currency: true, totalMinor: true, createdAt: true,
      } }),
    ]);
    return {
      orders: orders.map((o) => ({ ...o, totalMinor: o.totalMinor.toString() })),
      invoices: invoices.map((i) => ({ ...i, totalMinor: i.totalMinor.toString() })),
    };
  }
}

@Module({ imports: [AuthModule], controllers: [AdminReadController] })
export class AdminReadModule {}
