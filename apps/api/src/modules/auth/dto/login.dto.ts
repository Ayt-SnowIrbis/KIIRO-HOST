import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsString()
  @MinLength(1)
  turnstileToken!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  totpCode?: string;
}
