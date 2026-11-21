import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.module';

@Injectable()
export class EmailVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly ttlMs = 30 * 60 * 1000;

  private hashToken(token: string): string {
    return createHash('sha256')
      .update(token, 'utf8')
      .digest('hex');
  }

  async create(userId: string): Promise<{
    token: string;
    expiresAt: Date;
  }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await this.prisma.$transaction(async (tx) => {
      await tx.authToken.deleteMany({
        where: {
          userId,
          type: 'EMAIL_VERIFICATION',
        },
      });

      await tx.authToken.create({
        data: {
          userId,
          type: 'EMAIL_VERIFICATION',
          tokenHash: this.hashToken(token),
          expiresAt,
        },
      });
    });

    return { token, expiresAt };
  }

  async verify(token: string): Promise<{ success: true }> {
    if (
      typeof token !== 'string' ||
      token.length < 32 ||
      token.length > 256
    ) {
      throw new BadRequestException({
        code: 'AUTH_INVALID_VERIFY_TOKEN',
        message: 'Invalid verification token',
      });
    }

    const tokenHash = this.hashToken(token);

    await this.prisma.$transaction(async (tx) => {
      const stored = await tx.authToken.findUnique({
        where: { tokenHash },
      });

      if (!stored || stored.type !== 'EMAIL_VERIFICATION' || stored.usedAt) {
        throw new BadRequestException({
          code: 'AUTH_INVALID_VERIFY_TOKEN',
          message: 'Invalid verification token',
        });
      }

      if (stored.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException({
          code: 'AUTH_VERIFY_TOKEN_EXPIRED',
          message: 'Verification token expired',
        });
      }

      const consumed = await tx.authToken.updateMany({
        where: {
          id: stored.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      if (consumed.count !== 1) {
        throw new BadRequestException({
          code: 'AUTH_INVALID_VERIFY_TOKEN',
          message: 'Verification token already used',
        });
      }

      const activated = await tx.user.updateMany({
        where: {
          id: stored.userId,
          status: 'PENDING_VERIFICATION',
          emailVerifiedAt: null,
        },
        data: {
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      });

      if (activated.count !== 1) {
        throw new BadRequestException({
          code: 'AUTH_INVALID_VERIFY_TOKEN',
          message: 'Account cannot be verified',
        });
      }
    });

    return { success: true };
  }
}
