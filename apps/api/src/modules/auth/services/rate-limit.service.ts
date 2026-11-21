import {
  Injectable,
  Logger,
  OnModuleDestroy,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

export type AuthRateLimitAction =
  | 'register'
  | 'login'
  | 'resend-verification'
  | 'forgot-password'
  | 'verify-email'
  | 'totp';

interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);

  private readPositiveInteger(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;

    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Invalid ${name}: expected a positive integer`);
    }
    return value;
  }

  private readonly policies: Record<AuthRateLimitAction, RateLimitPolicy> = {
    register: {
      limit: this.readPositiveInteger('AUTH_RATE_LIMIT_REGISTER_MAX', 5),
      windowSeconds: this.readPositiveInteger('AUTH_RATE_LIMIT_REGISTER_WINDOW_SECONDS', 3600),
    },
    login: {
      limit: this.readPositiveInteger('AUTH_RATE_LIMIT_LOGIN_MAX', 10),
      windowSeconds: this.readPositiveInteger('AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS', 900),
    },
    'resend-verification': {
      limit: this.readPositiveInteger('AUTH_RATE_LIMIT_RESEND_VERIFICATION_MAX', 3),
      windowSeconds: this.readPositiveInteger('AUTH_RATE_LIMIT_RESEND_VERIFICATION_WINDOW_SECONDS', 3600),
    },
    'forgot-password': {
      limit: this.readPositiveInteger('AUTH_RATE_LIMIT_FORGOT_PASSWORD_MAX', 3),
      windowSeconds: this.readPositiveInteger('AUTH_RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS', 3600),
    },
    totp: {
      limit: this.readPositiveInteger('AUTH_RATE_LIMIT_TOTP_MAX', 5),
      windowSeconds: this.readPositiveInteger('AUTH_RATE_LIMIT_TOTP_WINDOW_SECONDS', 900),
    },
    'verify-email': {
      limit: this.readPositiveInteger('AUTH_RATE_LIMIT_VERIFY_EMAIL_MAX', 10),
      windowSeconds: this.readPositiveInteger('AUTH_RATE_LIMIT_VERIFY_EMAIL_WINDOW_SECONDS', 900),
    },
  };

  private client: RedisClientType | null = null;
  private connecting: Promise<RedisClientType> | null = null;

  private readonly incrementScript = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return count
  `;

  private async getClient(): Promise<RedisClientType> {
    if (this.client?.isReady) {
      return this.client;
    }

    if (this.connecting) {
      return this.connecting;
    }

    const url = process.env.REDIS_URL;

    if (!url) {
      throw new Error('REDIS_URL is not configured');
    }

    const client: RedisClientType = createClient({
      url,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: false,
      },
    });

    client.on('error', () => {
      this.logger.warn('Redis connection error');
    });

    this.connecting = client.connect()
      .then(() => {
        this.client = client;
        return client;
      })
      .catch((error: unknown) => {
        this.logger.error('Redis connection failed');
        throw error;
      })
      .finally(() => {
        this.connecting = null;
      });

    return this.connecting;
  }

  private hashIdentifier(identifier: string): string {
    return createHash('sha256')
      .update(identifier.trim().toLowerCase())
      .digest('hex');
  }

  async check(
    action: AuthRateLimitAction,
    identifier: string,
  ): Promise<void> {
    if (!identifier || identifier.length > 512) {
      throw new Error('Invalid rate limit identifier');
    }

    const policy = this.policies[action];

    const key = [
      'kiiro',
      'auth',
      'ratelimit',
      action,
      this.hashIdentifier(identifier),
    ].join(':');

    let count: number;

    try {
      const client = await this.getClient();

      const result = await client.eval(
        this.incrementScript,
        {
          keys: [key],
          arguments: [String(policy.windowSeconds)],
        },
      );

      count = Number(result);

      if (!Number.isFinite(count)) {
        throw new Error('Invalid Redis counter');
      }
    } catch {
      // Fail closed: do not bypass rate limiting if Redis is down.
      throw new HttpException({
        code: 'AUTH_RATE_LIMIT_UNAVAILABLE',
        message: 'Authentication temporarily unavailable',
      }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (count > policy.limit) {
      throw new HttpException({
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }
}
