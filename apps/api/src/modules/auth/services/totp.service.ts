import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.module';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  totpProvisioningUri,
  verifyTotp,
} from './totp.crypto';

@Injectable()
export class TotpService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enrollment is available only to a verified, active user.
   * Caller MUST authenticate the user using a backend-validated session.
   * Never log or cache the returned provisioning URI.
   */
  async beginEnrollment(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true, emailVerifiedAt: true },
    });
    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) {
      throw new ForbiddenException('Verified active account required');
    }

    const existing = await this.prisma.userTotp.findUnique({ where: { userId } });
    if (existing?.enabledAt) {
      throw new ConflictException('TOTP is already enabled');
    }

    const secret = generateTotpSecret();
    const encryptedSecret = Uint8Array.from(encryptTotpSecret(secret));

    await this.prisma.userTotp.upsert({
      where: { userId },
      create: { userId, encryptedSecret, keyVersion: 1 },
      update: { encryptedSecret, keyVersion: 1, lastUsedStep: null },
    });

    return { provisioningUri: totpProvisioningUri(user.email, secret) };
  }

  /**
   * Activates enrollment only after a valid code.
   * Atomic step claim prevents parallel reuse of the same code.
   */
  async confirmEnrollment(userId: string, code: string): Promise<void> {
    const enrollment = await this.prisma.userTotp.findUnique({ where: { userId } });
    if (!enrollment || enrollment.enabledAt) {
      throw new ForbiddenException('No pending TOTP enrollment');
    }

    const step = verifyTotp(
      decryptTotpSecret(enrollment.encryptedSecret),
      code,
      enrollment.lastUsedStep,
    );
    if (step === null) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    const result = await this.prisma.userTotp.updateMany({
      where: {
        userId,
        enabledAt: null,
        encryptedSecret: { equals: enrollment.encryptedSecret },
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
      },
      data: { enabledAt: new Date(), lastUsedStep: step },
    });
    if (result.count !== 1) {
      throw new ConflictException('TOTP enrollment changed; retry');
    }
  }

  /**
   * Consume a TOTP code exactly once. Must be called after password
   * verification and before issuing an administrator session.
   * The controller MUST enforce per-IP and per-user rate limits.
   */
  async consumeCode(userId: string, code: string): Promise<void> {
    const enrollment = await this.prisma.userTotp.findUnique({ where: { userId } });
    if (!enrollment?.enabledAt) {
      throw new ForbiddenException('TOTP enrollment required');
    }

    const step = verifyTotp(
      decryptTotpSecret(enrollment.encryptedSecret),
      code,
      enrollment.lastUsedStep,
    );
    if (step === null) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    const result = await this.prisma.userTotp.updateMany({
      where: {
        userId,
        enabledAt: { not: null },
        encryptedSecret: enrollment.encryptedSecret,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }],
      },
      data: { lastUsedStep: step },
    });
    if (result.count !== 1) {
      throw new UnauthorizedException('TOTP code already used');
    }
  }
}
