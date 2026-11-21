import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.module';
import { Prisma } from '@prisma/client';
import { TurnstileService } from './turnstile.service';
import { EmailConfirmationService } from './email-confirmation.service';
import { PasswordService } from './password.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly turnstile: TurnstileService,
    private readonly emailConfirmation: EmailConfirmationService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async register(dto: RegisterDto, remoteIp?: string) {
    await this.turnstile.verify(
      dto.turnstileToken,
      remoteIp,
    );

    const email = this.normalizeEmail(dto.email);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException({
        code: 'AUTH_EMAIL_ALREADY_EXISTS',
        message: 'Email already registered',
      });
    }

    const passwordHash = await this.passwords.hash(dto.password);

    let user;

    try {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          role: 'USER',
          status: 'PENDING_VERIFICATION',
          customer: {
            create: {
              displayName: dto.displayName?.trim() || null,
            },
          },
        },
        include: { customer: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'AUTH_EMAIL_ALREADY_EXISTS',
          message: 'Email already registered',
        });
      }

      throw error;
    }

    await this.emailConfirmation.send(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: 'user',
        status: 'pending_verification',
        emailVerified: false,
        displayName: user.customer?.displayName ?? undefined,
      },
      verificationRequired: true,
    };
  }

  async validateCredentials(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { customer: true },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const valid = await this.passwords.verify(
      user.passwordHash,
      dto.password,
    );

    if (!valid) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException({
        code: 'AUTH_ACCOUNT_SUSPENDED',
        message: 'Account suspended',
      });
    }

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: 'AUTH_EMAIL_NOT_VERIFIED',
        message: 'Email verification required',
      });
    }

    if (user.role === 'ADMIN') {
      throw new ForbiddenException({
        code: 'AUTH_2FA_REQUIRED',
        message: 'Administrator TOTP verification required',
      });
    }

    return {
      id: user.id,
      email: user.email,
      role: 'user' as const,
      status: 'active' as const,
      emailVerified: true,
      displayName: user.customer?.displayName ?? undefined,
    };
  }
}
