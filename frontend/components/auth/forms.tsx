"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  forgotPassword,
  normalizeAuthError,
  resendVerification,
  resetPassword,
} from "@/lib/api/auth";
import { resolveAuthErrorMessage } from "@/lib/auth/errors";
import type { Dictionary } from "@/lib/i18n/types";
import TurnstileWidget from "./turnstile-widget";

interface FormProps {
  dictionary: Dictionary;
}

interface VerifyEmailFormProps extends FormProps {
  token?: string;
  next?: string;
}

interface ResetPasswordFormProps extends FormProps {
  initialToken?: string;
}

async function startLocalSession(payload: {
  email: string;
  password: string;
  turnstileToken: string;
}) {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as {
    ok?: boolean;
    redirectTo?: string;
    message?: string;
    code?: string;
  };

  if (!response.ok) {
    throw data;
  }

  return data;
}

async function submitRegistration(payload: {
  email: string;
  password: string;
  displayName?: string;
  turnstileToken: string;
}) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as {
    ok?: boolean;
    message?: string;
    code?: string;
  };

  if (!response.ok) {
    throw data;
  }

  return data;
}

async function submitVerifyEmail(payload: { token: string; next?: string }) {
  const response = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as {
    ok?: boolean;
    redirectTo?: string;
    message?: string;
    code?: string;
  };

  if (!response.ok) {
    throw data;
  }

  return data;
}

function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-slate-600">{description}</p>
      <div className="mt-6 space-y-4">{children}</div>
    </section>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

function SuccessBanner({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>;
}

export function LoginForm({
  dictionary,
  successMessage,
}: FormProps & { successMessage?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <AuthCard title={dictionary.auth.loginTitle} description={dictionary.auth.loginDescription}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setLoading(true);
          try {
            const response = await startLocalSession({ email, password, turnstileToken });
            router.replace(response.redirectTo ?? "/dashboard");
            router.refresh();
          } catch (rawError) {
            setError(resolveAuthErrorMessage(normalizeAuthError(rawError), dictionary.errors));
          } finally {
            setLoading(false);
          }
        }}
      >
        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.emailLabel}
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.passwordLabel}
          <input
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <TurnstileWidget value={turnstileToken} onChange={setTurnstileToken} />
        <SuccessBanner message={successMessage ?? null} />
        <ErrorBanner message={error} />

        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          disabled={loading || !turnstileToken}
        >
          {loading ? dictionary.common.loading : dictionary.auth.loginAction}
        </button>
      </form>

      <div className="flex flex-wrap gap-3 text-sm text-slate-600">
        <span>{dictionary.auth.noAccountYet}</span>
        <Link href="/register" className="underline">
          {dictionary.auth.goToRegister}
        </Link>
        <Link href="/forgot-password" className="underline">
          {dictionary.auth.goToForgotPassword}
        </Link>
        <Link href="/resend-verification" className="underline">
          {dictionary.auth.goToResendVerification}
        </Link>
      </div>
    </AuthCard>
  );
}

export function RegisterForm({ dictionary }: FormProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <AuthCard title={dictionary.auth.registerTitle} description={dictionary.auth.registerDescription}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setSuccess(null);
          setLoading(true);
          try {
            await submitRegistration({ email, password, displayName, turnstileToken });
            setSuccess(dictionary.auth.checkEmailNotice);
          } catch (rawError) {
            setError(resolveAuthErrorMessage(normalizeAuthError(rawError), dictionary.errors));
          } finally {
            setLoading(false);
          }
        }}
      >
        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.displayNameLabel}
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.emailLabel}
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.passwordLabel}
          <input
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <TurnstileWidget value={turnstileToken} onChange={setTurnstileToken} />
        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          disabled={loading || !turnstileToken}
        >
          {loading ? dictionary.common.loading : dictionary.auth.registerAction}
        </button>
      </form>

      <div className="flex flex-wrap gap-3 text-sm text-slate-600">
        <span>{dictionary.auth.alreadyHaveAccount}</span>
        <Link href="/login" className="underline">
          {dictionary.auth.goToLogin}
        </Link>
      </div>
    </AuthCard>
  );
}

export function VerifyEmailForm({ dictionary, token, next }: VerifyEmailFormProps) {
  const router = useRouter();
  const hasAutoSubmittedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleVerificationSubmission = useCallback(async () => {
    if (!token) {
      setError(dictionary.errors.missingToken);
      return;
    }

    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const response = await submitVerifyEmail({ token, next });
      setSuccess(dictionary.auth.verifiedSuccess);

      if (response.redirectTo) {
        router.replace(response.redirectTo);
        router.refresh();
      }
    } catch (rawError) {
      setError(resolveAuthErrorMessage(normalizeAuthError(rawError), dictionary.errors));
    } finally {
      setLoading(false);
    }
  }, [dictionary.auth.verifiedSuccess, dictionary.errors, next, router, token]);

  useEffect(() => {
    if (!token || hasAutoSubmittedRef.current) {
      return;
    }

    hasAutoSubmittedRef.current = true;
    void handleVerificationSubmission();
  }, [handleVerificationSubmission, token]);

  return (
    <AuthCard title={dictionary.auth.verifyEmailTitle} description={dictionary.auth.verifyEmailDescription}>
      {loading ? <p className="text-sm text-slate-600">{dictionary.common.loading}</p> : null}
      <SuccessBanner message={success} />
      <ErrorBanner message={error} />
      <button
        type="button"
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        disabled={loading || !token}
        onClick={() => {
          void handleVerificationSubmission();
        }}
      >
        {dictionary.auth.verifyAction}
      </button>
      <div className="flex flex-wrap gap-3 text-sm text-slate-600">
        <Link href="/login" className="underline">
          {dictionary.auth.goToLogin}
        </Link>
        <Link href="/resend-verification" className="underline">
          {dictionary.auth.goToResendVerification}
        </Link>
      </div>
    </AuthCard>
  );
}

export function ResendVerificationForm({ dictionary }: FormProps) {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <AuthCard title={dictionary.auth.resendVerificationTitle} description={dictionary.auth.resendVerificationDescription}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setSuccess(null);
          setLoading(true);
          try {
            await resendVerification({ email, turnstileToken });
            setSuccess(dictionary.auth.verificationResentSuccess);
          } catch (rawError) {
            setError(resolveAuthErrorMessage(normalizeAuthError(rawError), dictionary.errors));
          } finally {
            setLoading(false);
          }
        }}
      >
        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.emailLabel}
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <TurnstileWidget value={turnstileToken} onChange={setTurnstileToken} />
        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          disabled={loading || !turnstileToken}
        >
          {loading ? dictionary.common.loading : dictionary.auth.resendAction}
        </button>
      </form>

      <Link href="/login" className="text-sm text-slate-600 underline">
        {dictionary.auth.backToLogin}
      </Link>
    </AuthCard>
  );
}

export function ForgotPasswordForm({ dictionary }: FormProps) {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <AuthCard title={dictionary.auth.forgotPasswordTitle} description={dictionary.auth.forgotPasswordDescription}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setSuccess(null);
          setLoading(true);
          try {
            await forgotPassword({ email, turnstileToken });
            setSuccess(dictionary.auth.forgotSuccess);
          } catch (rawError) {
            setError(resolveAuthErrorMessage(normalizeAuthError(rawError), dictionary.errors));
          } finally {
            setLoading(false);
          }
        }}
      >
        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.emailLabel}
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <TurnstileWidget value={turnstileToken} onChange={setTurnstileToken} />
        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          disabled={loading || !turnstileToken}
        >
          {loading ? dictionary.common.loading : dictionary.auth.forgotAction}
        </button>
      </form>

      <Link href="/login" className="text-sm text-slate-600 underline">
        {dictionary.auth.backToLogin}
      </Link>
    </AuthCard>
  );
}

export function ResetPasswordForm({ dictionary, initialToken }: ResetPasswordFormProps) {
  const [token, setToken] = useState(initialToken ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <AuthCard title={dictionary.auth.resetPasswordTitle} description={dictionary.auth.resetPasswordDescription}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setSuccess(null);
          setLoading(true);
          try {
            await resetPassword({ token, newPassword, turnstileToken });
            setSuccess(dictionary.auth.resetSuccess);
          } catch (rawError) {
            setError(resolveAuthErrorMessage(normalizeAuthError(rawError), dictionary.errors));
          } finally {
            setLoading(false);
          }
        }}
      >
        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.tokenLabel}
          <input
            required
            type="text"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          {dictionary.auth.newPasswordLabel}
          <input
            required
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <TurnstileWidget value={turnstileToken} onChange={setTurnstileToken} />
        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <button
          type="submit"
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          disabled={loading || !turnstileToken}
        >
          {loading ? dictionary.common.loading : dictionary.auth.resetAction}
        </button>
      </form>

      <Link href="/login" className="text-sm text-slate-600 underline">
        {dictionary.auth.backToLogin}
      </Link>
    </AuthCard>
  );
}
