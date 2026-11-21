import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.module';

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
  mfaVerified?: boolean;
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly ttlMs = 24 * 60 * 60 * 1000;

  private hashToken(token: string): string {
    return createHash('sha256')
      .update(token, 'utf8')
      .digest('hex');
  }

  async create(userId: string, metadata: SessionMetadata = {}) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);

    const expiresAt = new Date(Date.now() + this.ttlMs);

    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash,
        mfaVerifiedAt: metadata.mfaVerified ? new Date() : null,
        expiresAt,
        ipAddress: metadata.ipAddress?.slice(0, 64),
        userAgent: metadata.userAgent?.slice(0, 512),
      },
    });

    return {
      token,
      sessionId: session.id,
      expiresAt,
    };
  }

  async validate(token: string) {
    if (!token || token.length > 256) {
      return null;
    }

    const tokenHash = this.hashToken(token);

    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            customer: true,
          },
        },
      },
    });

    if (!session) {
      return null;
    }

    if (session.revokedAt) {
      return null;
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    if (
      session.user.status !== 'ACTIVE' ||
      !session.user.emailVerifiedAt
    ) {
      return null;
    }

    // Администраторам потребуется обязательный TOTP.
    // До его внедрения административные сессии запрещены.
    if (session.user.role === 'ADMIN' && !session.mfaVerifiedAt) {
      return null;
    }

    return {
      sessionId: session.id,
      userId: session.userId,
      user: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role.toLowerCase(),
        status: session.user.status.toLowerCase(),
        emailVerified: true,
        displayName: session.user.customer?.displayName ?? undefined,
      },
      expiresAt: session.expiresAt,
    };
  }

  async revoke(token: string): Promise<boolean> {
    if (!token || token.length > 256) {
      return false;
    }

    const result = await this.prisma.session.updateMany({
      where: {
        tokenHash: this.hashToken(token),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return result.count > 0;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return result.count;
  }
}
