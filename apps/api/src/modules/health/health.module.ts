import { Controller, Get, Module } from "@nestjs/common";
import { PrismaService } from "../database/prisma.module";

@Controller("health")
class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get("live") live() { return { status: "ok", service: "api", timestamp: new Date().toISOString() }; }
  @Get("ready") async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ready", database: "connected", timestamp: new Date().toISOString() };
  }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}
