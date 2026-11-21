export const USER_STATUSES = ["pending_verification", "active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface User {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  displayName?: string;
}

export const AUTH_ERROR_CODES = [
  "AUTH_INVALID_CREDENTIALS",
  "AUTH_EMAIL_NOT_VERIFIED",
  "AUTH_ACCOUNT_SUSPENDED",
  "AUTH_EMAIL_ALREADY_EXISTS",
  "AUTH_WEAK_PASSWORD",
  "AUTH_BOT_PROTECTION_FAILED",
  "AUTH_INVALID_VERIFY_TOKEN",
  "AUTH_VERIFY_TOKEN_EXPIRED",
  "AUTH_UNKNOWN",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export interface AuthError {
  code: AuthErrorCode;
  message?: string;
  status?: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName?: string;
  locale?: string;
  verificationUrl?: string;
  turnstileToken: string;
}

export interface RegisterResponse {
  user: User;
  verificationRequired: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  turnstileToken: string;
  totpCode?: string;
}

export interface LoginResponse {
  user: User;
}

export interface LogoutResponse {
  success: boolean;
}

export interface AuthMeResponse {
  user: User | null;
}

export interface VerifyEmailResponse {
  success: boolean;
}

export interface ResendVerificationRequest {
  email: string;
  turnstileToken: string;
}

export interface ResendVerificationResponse {
  success: boolean;
}

export interface ForgotPasswordRequest {
  email: string;
  turnstileToken: string;
}

export interface ForgotPasswordResponse {
  success: boolean;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
  turnstileToken: string;
}

export interface ResetPasswordResponse {
  success: boolean;
}
