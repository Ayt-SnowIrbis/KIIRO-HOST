import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';
import { MailService } from './mail.service';

@Injectable()
export class EmailConfirmationService {
  constructor(
    private readonly verification: EmailVerificationService,
    private readonly mail: MailService,
  ) {}

  async send(userId: string, email: string): Promise<void> {
    const publicAppUrl = process.env.PUBLIC_APP_URL;

    if (!publicAppUrl) {
      throw new InternalServerErrorException(
        'PUBLIC_APP_URL is not configured',
      );
    }

    const base = new URL(publicAppUrl);

    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password
    ) {
      throw new InternalServerErrorException(
        'Invalid PUBLIC_APP_URL configuration',
      );
    }

    const { token } = await this.verification.create(userId);

    const url = new URL('/verify-email', base);
    url.searchParams.set('token', token);

    await this.mail.sendVerificationEmail(
      email,
      url.toString(),
    );
  }
}
