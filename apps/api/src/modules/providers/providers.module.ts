import { Controller, Get, Module } from "@nestjs/common";
import type { Provider } from "@prisma/client";
import { PrismaService } from "../database/prisma.module";

@Controller("compute/providers")
class ProvidersController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() async list() {
    const rows = await this.prisma.provider.findMany({ orderBy: { name: "asc" } });
    return rows.map((provider: Provider) => ({
      id: provider.id,
      slug: provider.slug.toLowerCase(),
      name: provider.name,
      description: provider.description ?? "",
      status: provider.status === "ACTIVE" ? "active" : provider.status === "MAINTENANCE" ? "maintenance" : "planned",
      supportedInstanceKinds: [],
      capabilities: { start: false, stop: false, reboot: false, snapshots: false, console: false, resize: false, reinstall: false },
    }));
  }
}
@Module({ controllers: [ProvidersController] })
export class ProvidersModule {}
