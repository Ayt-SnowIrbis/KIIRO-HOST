import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateBy,
} from 'class-validator';

function passwordLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 128) {
    throw new Error(`Invalid ${name}: expected an integer from 1 to 128`);
  }
  return value;
}

export const passwordPolicy = {
  min: passwordLimit('AUTH_PASSWORD_MIN_LENGTH', 8),
  max: passwordLimit('AUTH_PASSWORD_MAX_LENGTH', 128),
};

if (passwordPolicy.min > passwordPolicy.max) {
  throw new Error('AUTH_PASSWORD_MIN_LENGTH must not exceed AUTH_PASSWORD_MAX_LENGTH');
}

export class RegisterDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @ValidateBy({
    name: 'passwordLength',
    validator: {
      validate(value: unknown) {
        return typeof value === 'string' &&
          value.length >= passwordPolicy.min &&
          value.length <= passwordPolicy.max;
      },
      defaultMessage() {
        return `password must contain between ${passwordPolicy.min} and ${passwordPolicy.max} characters`;
      },
    },
  })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsString()
  @MinLength(1)
  turnstileToken!: string;
}
