import { Module } from "@nestjs/common";
import { PrismaModule } from "./database/prisma.module";
import { HealthModule } from "./health/health.module";
import { ProvidersModule } from "./providers/providers.module";

@Module({ imports: [PrismaModule, HealthModule, ProvidersModule] })
export class AppModule {}
