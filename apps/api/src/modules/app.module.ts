import { ComputeModule } from "./compute/compute.module";
import { AdminReadModule } from "./compute/admin-read.module";
import { AdminWriteModule } from "./compute/admin-write.module";
import { AuthModule } from "./auth/auth.module";
import { Module } from "@nestjs/common";
import { PrismaModule } from "./database/prisma.module";
import { HealthModule } from "./health/health.module";
import { ProvidersModule } from "./providers/providers.module";

@Module({ imports: [AuthModule, PrismaModule, HealthModule, ProvidersModule, ComputeModule, AdminReadModule, AdminWriteModule] })
export class AppModule {}
