import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

interface TurnstileResponse {
  success: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  async verify(
    token: string,
    remoteIp?: string,
    expectedAction?: string,
  ): Promise<void> {
    const secret = process.env.TURNSTILE_SECRET_KEY;

    if (!secret) {
      this.logger.error('TURNSTILE_SECRET_KEY is not configured');
      this.reject();
    }

    if (
      typeof token !== 'string' ||
      token.length < 1 ||
      token.length > 2048
    ) {
      this.reject();
    }

    const body = new URLSearchParams({
      secret: secret!,
      response: token,
      idempotency_key: randomUUID(),
    });

    if (remoteIp) {
      body.set('remoteip', remoteIp);
    }

    let result: TurnstileResponse;

    try {
      const response = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        this.reject();
      }

      result = (await response.json()) as TurnstileResponse;
    } catch {
      this.logger.warn('Turnstile verification request failed');
      this.reject();
    }

    if (!result!.success) {
      this.reject();
    }

    const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;

    if (
      expectedHostname &&
      result!.hostname !== expectedHostname
    ) {
      this.reject();
    }

    if (
      expectedAction &&
      result!.action !== expectedAction
    ) {
      this.reject();
    }
  }

  private reject(): never {
    throw new ForbiddenException({
      code: 'AUTH_BOT_PROTECTION_FAILED',
      message: 'Bot protection verification failed',
    });
  }
}
