import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../database/prisma.module';
import { EmailConfirmationService } from './services/email-confirmation.service';

import { AuthService } from './services/auth.service';
import { EmailVerificationService } from './services/email-verification.service';
import { SessionService } from './services/session.service';
import { TurnstileService } from './services/turnstile.service';
import { RateLimitService } from './services/rate-limit.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TotpService } from './services/totp.service';

class TotpEnrollDto {
  @IsString()
  @MinLength(1)
  password!: string;
}

class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

class ResendVerificationDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  turnstileToken!: string;
}

const SESSION_COOKIE = 'kiiro_session';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly emailVerification: EmailVerificationService,
    private readonly sessions: SessionService,
    private readonly turnstile: TurnstileService,
    private readonly rateLimit: RateLimitService,
    private readonly prisma: PrismaService,
    private readonly emailConfirmation: EmailConfirmationService,
    private readonly totp: TotpService,
  ) {}

  private getClientIp(request: Request): string {
    // Until trusted proxy configuration is established,
    // use the direct connection address only.
    return request.socket.remoteAddress ?? 'unknown';
  }

  private readSessionCookie(request: Request): string | null {
    const cookieHeader = request.headers.cookie ?? '';

    const match = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

    if (!match) {
      return null;
    }

    const value = match.slice(SESSION_COOKIE.length + 1);

    return /^[A-Za-z0-9_-]{32,256}$/.test(value)
      ? value
      : null;
  }

  private setSessionCookie(
    response: Response,
    token: string,
    expiresAt: Date,
  ): void {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private clearSessionCookie(response: Response): void {
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
  ) {
    const ip = this.getClientIp(request);

    await this.rateLimit.check('register', `ip:${ip}`);
    await this.rateLimit.check(
      'register',
      `email:${dto.email.trim().toLowerCase()}`,
    );

    return this.auth.register(dto, ip);
  }

  @Post('resend-verification')
  async resendVerification(
    @Body() dto: ResendVerificationDto,
    @Req() request: Request,
  ) {
    const ip = this.getClientIp(request);
    const email = dto.email.trim().toLowerCase();

    await this.rateLimit.check('resend-verification', `ip:${ip}`);
    await this.rateLimit.check('resend-verification', `email:${email}`);
    await this.turnstile.verify(dto.turnstileToken, ip);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true, emailVerifiedAt: true },
    });

    if (user?.status === 'PENDING_VERIFICATION' && !user.emailVerifiedAt) {
      await this.emailConfirmation.send(user.id, email);
    }

    // Do not disclose whether an account exists or is already verified.
    return { success: true };
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    return this.emailVerification.verify(token);
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const ip = this.getClientIp(request);

    await this.rateLimit.check('login', `ip:${ip}`);
    await this.rateLimit.check(
      'login',
      `email:${dto.email.trim().toLowerCase()}`,
    );

    await this.turnstile.verify(dto.turnstileToken, ip);

    const user = await this.auth.validateCredentials(dto, true);
    if (user.role === 'admin') {
      await this.rateLimit.check('totp', `ip:${ip}`);
      await this.rateLimit.check('totp', `email:${user.email}`);
      if (!dto.totpCode) {
        throw new UnauthorizedException({
          code: 'AUTH_2FA_REQUIRED',
          message: 'Administrator TOTP code required',
        });
      }
      await this.totp.consumeCode(user.id, dto.totpCode);
    }

    const session = await this.sessions.create(user.id, {
      ipAddress: ip,
      userAgent: request.headers['user-agent'],
      mfaVerified: user.role === 'admin',
    });

    this.setSessionCookie(
      response,
      session.token,
      session.expiresAt,
    );

    return { user };
  }

  private async requireAuthenticatedUser(request: Request) {
    const token = this.readSessionCookie(request);
    const session = token ? await this.sessions.validate(token) : null;
    if (!session) throw new UnauthorizedException('Authentication required');
    return session;
  }

  @Post('totp/enroll')
  async enrollTotp(@Body() dto: TotpEnrollDto, @Req() request: Request) {
    const session = await this.requireAuthenticatedUser(request);
    await this.rateLimit.check('totp', `user:${session.userId}`);
    // Re-authenticate before disclosing an enrollment secret.
    const verified = await this.auth.validateCredentials({
      email: session.user.email,
      password: dto.password,
      turnstileToken: '',
    });
    if (verified.id !== session.userId || verified.role !== 'user') {
      throw new UnauthorizedException('Reauthentication failed');
    }
    return this.totp.beginEnrollment(session.userId);
  }

  @Post('totp/confirm')
  async confirmTotp(@Body() dto: TotpCodeDto, @Req() request: Request) {
    const session = await this.requireAuthenticatedUser(request);
    await this.rateLimit.check('totp', `user:${session.userId}`);
    await this.totp.confirmEnrollment(session.userId, dto.code);
    return { success: true };
  }

  @Get('me')
  async me(@Req() request: Request) {
    const token = this.readSessionCookie(request);

    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH_UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    const session = await this.sessions.validate(token);

    if (!session) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_EXPIRED',
        message: 'Session expired or revoked',
      });
    }

    return { user: session.user };
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = this.readSessionCookie(request);

    if (token) {
      await this.sessions.revoke(token);
    }

    this.clearSessionCookie(response);

    return { success: true };
  }
}
