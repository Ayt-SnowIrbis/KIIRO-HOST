import https from "node:https";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { Controller, ForbiddenException, Get, Module, NotFoundException, Param, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";
import { PrismaService } from "../database/prisma.module";

type Envelope = { type?: string; metadata?: unknown; error?: string };
function fingerprint(cert: Buffer) { return new X509Certificate(cert).fingerprint256.replaceAll(":", "").toLowerCase(); }
function pinnedAgent(): { base: URL; agent: https.Agent } {
  const base = new URL(process.env.INCUS_API_URL ?? "");
  if (base.protocol !== "https:" || base.hostname !== "incus-01-test" || base.port !== "8443" ||
      base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Unexpected Incus endpoint");
  const ca = readFileSync(process.env.INCUS_SERVER_CERT_PATH ?? "");
  const pin = (process.env.INCUS_SERVER_FINGERPRINT ?? "").replaceAll(":", "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(pin) || fingerprint(ca) !== pin) throw new Error("Server certificate pin mismatch");
  const agent = new https.Agent({
    cert: readFileSync(process.env.INCUS_CLIENT_CERT_PATH ?? ""),
    key: readFileSync(process.env.INCUS_CLIENT_KEY_PATH ?? ""),
    ca, rejectUnauthorized: true,
    checkServerIdentity: (_host, cert) => cert.fingerprint256?.replaceAll(":", "").toLowerCase() === pin ? undefined : new Error("Server certificate mismatch"),
  });
  return { base, agent };
}
async function incusGet(path: string): Promise<unknown> {
  const { base, agent } = pinnedAgent();
  return new Promise((resolve, reject) => {
    const req = https.get(new URL(path, base), { agent, timeout: 6000, headers: { Accept: "application/json" } }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512 * 1024) req.destroy(new Error("Incus response too large"));
        else chunks.push(chunk);
      });
      res.on("end", () => {
        if (size > 512 * 1024) return reject(new Error("Incus response too large"));
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Envelope;
          if (res.statusCode !== 200 || payload.type !== "sync") return reject(new Error("Incus request failed"));
          resolve(payload.metadata);
        } catch { reject(new Error("Invalid Incus response")); }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Incus timeout")));
    req.on("error", reject);
  });
}
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
    const configured = id === "incus-test-node-01" && node.provider.slug === "INCUS" && meta.mode === "REAL" && meta.testNode === true &&
      process.env.INCUS_ADMIN_PROBE_ENABLED === "true";
    const checkedAt = new Date().toISOString();
    if (!configured) return { state: "NOT_CONFIGURED", checkedAt, networks: [], storagePools: [], resources: null, certificates: { configured: false } };
    try {
      const [info, networks, storagePools, resources] = await Promise.all([
        incusGet("/1.0"), incusGet("/1.0/networks"), incusGet("/1.0/storage-pools"), incusGet("/1.0/resources"),
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
        certificates: { configured: true, serverFingerprint: (process.env.INCUS_SERVER_FINGERPRINT ?? "").replaceAll(":", "").toLowerCase(), clientCertificatePathConfigured: Boolean(process.env.INCUS_CLIENT_CERT_PATH) },
      };
    } catch {
      return { state: "UNREACHABLE", checkedAt, networks: [], storagePools: [], resources: null, certificates: { configured: true } };
    }
  }
}
@Module({ imports: [AuthModule], controllers: [IncusInventoryController] })
export class IncusInventoryModule {}
