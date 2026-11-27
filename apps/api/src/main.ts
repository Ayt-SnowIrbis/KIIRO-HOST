import "reflect-metadata";
import { PrismaService } from "./modules/database/prisma.module";
import { SessionService } from "./modules/auth/services/session.service";
import { attachConsoleWebSocket } from "./modules/compute/console-websocket";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((v) => v.trim()),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  // Fail closed unless a trusted reverse proxy and private worker bridge are installed.
  attachConsoleWebSocket(app.getHttpServer(), app.get(PrismaService), app.get(SessionService));
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, "0.0.0.0");
}
void bootstrap();
