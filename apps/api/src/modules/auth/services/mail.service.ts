import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;
    const from = process.env.SMTP_FROM;

    if (
      !host ||
      !user ||
      !password ||
      !from ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error('SMTP configuration is missing or invalid');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: true,
      auth: {
        user,
        pass: password,
      },
      tls: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  private getFrom(): string {
    return process.env.SMTP_FROM!;
  }

  async sendMail(
    to: string,
    subject: string,
    text: string,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.getFrom(),
        to,
        subject,
        text,
      });
    } catch {
      this.logger.error('SMTP delivery failed');

      throw new InternalServerErrorException({
        code: 'AUTH_EMAIL_DELIVERY_FAILED',
        message: 'Email delivery temporarily unavailable',
      });
    }
  }

  async sendVerificationEmail(
    email: string,
    verificationUrl: string,
  ): Promise<void> {
    await this.sendMail(
      email,
      'KIIRO-HOST — Confirm your email',
      [
        'Welcome to KIIRO-HOST.',
        '',
        'Confirm your email address:',
        verificationUrl,
        '',
        'This link expires in 30 minutes.',
        '',
        'If you did not create this account, ignore this email.',
      ].join('\n'),
    );
  }

  async sendPasswordResetEmail(
    email: string,
    resetUrl: string,
  ): Promise<void> {
    await this.sendMail(
      email,
      'KIIRO-HOST — Reset your password',
      [
        'A password reset was requested for your account.',
        '',
        'Reset your password:',
        resetUrl,
        '',
        'This link expires in 30 minutes.',
        '',
        'If you did not request this, ignore this email.',
      ].join('\n'),
    );
  }

  async sendMagicLinkEmail(
    email: string,
    loginUrl: string,
  ): Promise<void> {
    await this.sendMail(
      email,
      'KIIRO-HOST — Sign in',
      [
        'Use the following link to sign in:',
        loginUrl,
        '',
        'This link expires in 30 minutes.',
        '',
        'If you did not request this, ignore this email.',
      ].join('\n'),
    );
  }
}
