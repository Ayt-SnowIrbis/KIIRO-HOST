import { AuthController } from './auth.controller';
import { RateLimitService } from './services/rate-limit.service';
import { Module } from '@nestjs/common';

import { AuthService } from './services/auth.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { EmailVerificationService } from './services/email-verification.service';
import { EmailConfirmationService } from './services/email-confirmation.service';
import { MailService } from './services/mail.service';
import { TurnstileService } from './services/turnstile.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    EmailVerificationService,
    EmailConfirmationService,
    MailService,
    TurnstileService,
    RateLimitService,
  ],
  exports: [
    AuthService,
    SessionService,
    EmailVerificationService,
    EmailConfirmationService,
    TurnstileService,
    RateLimitService,
  ],
})
export class AuthModule {}
