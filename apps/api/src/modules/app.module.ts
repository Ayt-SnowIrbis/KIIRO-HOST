import { ComputeModule } from "./compute/compute.module";
import { CustomerInstancesModule } from "./compute/customer-instances.module";
import { AdminReadModule } from "./compute/admin-read.module";
import { AdminWriteModule } from "./compute/admin-write.module";
import { CustomerAdminModule } from "./compute/customer-admin.module";
import { AuthModule } from "./auth/auth.module";
import { Module } from "@nestjs/common";
import { PrismaModule } from "./database/prisma.module";
import { HealthModule } from "./health/health.module";
import { ProvidersModule } from "./providers/providers.module";
import { InfrastructureModule } from "./compute/infrastructure.module";
import { SupportModule } from "./support/support.module";

@Module({
  imports: [
    AuthModule, PrismaModule, HealthModule, ProvidersModule, ComputeModule,
    CustomerInstancesModule, AdminReadModule, AdminWriteModule, CustomerAdminModule, SupportModule, InfrastructureModule,
  ],
})
export class AppModule {}
