import { createIncusConnection } from "./incus-connection";
import { Controller, ForbiddenException, Get, Module, NotFoundException, Param, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";
import { PrismaService } from "../database/prisma.module";

function safeObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function summaryList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, 200).map(s => s.split("/").pop() ?? s) : [];
}
@Controller("compute/admin/infrastructure")
class IncusInventoryController {
  constructor(private readonly db: PrismaService, private readonly sessions: SessionService) {}
  private async authorize(req: Request) {
    const token = (req.headers.cookie ?? "").split(";").map(s => s.trim()).find(s => s.startsWith("kiiro_session="))?.slice("kiiro_session=".length);
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthorizedException();
    if (session.user.role !== "admin") throw new ForbiddenException();
  }
  @Get("nodes/:id/inventory")
  async inventory(@Req() req: Request, @Param("id") id: string) {
    await this.authorize(req);
    const node = await this.db.node.findUnique({ where: { id }, select: { metadata: true, provider: { select: { slug: true } } } });
    if (!node) throw new NotFoundException("Node not found");
    const meta = safeObject(node.metadata);
    const configured = node.provider.slug === "INCUS" && meta.mode === "REAL" &&
      (
        (id === "incus-test-node-01" && meta.testNode === true) ||
        (id !== "incus-test-node-01" && Boolean(process.env.INCUS_NODE_CONFIG_DIR))
      ) &&
      process.env.INCUS_ADMIN_PROBE_ENABLED === "true";
    const checkedAt = new Date().toISOString();
    if (!configured) return { state: "NOT_CONFIGURED", checkedAt, networks: [], storagePools: [], resources: null, certificates: { configured: false } };
    try {
      const connection = createIncusConnection(id);
      const [info, networks, storagePools, resources] = await Promise.all([
        connection.get("/1.0"),
        connection.get("/1.0/networks"),
        connection.get("/1.0/storage-pools"),
        connection.get("/1.0/resources"),
      ]);
      const server = safeObject(info), environment = safeObject(server.environment);
      if (server.auth !== "trusted") throw new Error("Incus client is not trusted");
      const cpu = safeObject(safeObject(resources).cpu);
      const memory = safeObject(safeObject(resources).memory);
      return {
        state: "REACHABLE", checkedAt,
        server: { serverName: environment.server_name ?? null, serverVersion: environment.server_version ?? null },
        networks: summaryList(networks), storagePools: summaryList(storagePools),
        resources: { cpu: { total: cpu.total ?? null }, memory: { total: memory.total ?? null, used: memory.used ?? null } },
        certificates: { configured: true, serverFingerprint: connection.fingerprint, clientCertificatePathConfigured: true },
      };
    } catch {
      return { state: "UNREACHABLE", checkedAt, networks: [], storagePools: [], resources: null, certificates: { configured: true } };
    }
  }
}
@Module({ imports: [AuthModule], controllers: [IncusInventoryController] })
export class IncusInventoryModule {}
