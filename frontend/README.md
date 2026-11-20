# KIIRO HOST Frontend Starter Kit

Next.js (App Router) + TypeScript + Tailwind CSS starter for a vendor-neutral compute panel with starter-level auth and i18n foundation.

## What is included

- Public page: `/`
- Auth pages:
  - `/login`
  - `/register`
  - `/verify-email?token=...`
  - `/resend-verification`
  - `/forgot-password`
  - `/reset-password?token=...`
- User dashboard: `/dashboard`
- Admin dashboard: `/admin/dashboard`
- Guest-only auth route protection in `proxy.ts`
- Guest-only auth routes (redirect authenticated users)
- Vendor-neutral compute examples in `lib/compute/*`
- Typed API layer:
  - `lib/api/client.ts`
  - `lib/api/compute.ts`
  - `lib/api/auth.ts`
- Typed auth domain model in `lib/auth/types.ts`
- i18n foundation with language switching (`en`, `bg`)
- Cloudflare Turnstile widget integration point

> Frontend stays starter-level and backend-driven: browser code calls backend contracts, and backend is responsible for real auth and secret verification.

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

```env
API_BASE_URL=http://localhost:8080/api
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_MOCK_MODE=false
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_public_turnstile_site_key
SESSION_TTL_HOURS=24
AUTH_SESSION_SECRET=change-me-in-production
```

- `API_BASE_URL`: optional server-only backend API base URL override for Next.js route handlers. Falls back to `NEXT_PUBLIC_API_BASE_URL`.
- `NEXT_PUBLIC_API_BASE_URL`: backend API base URL.
- `NEXT_PUBLIC_APP_URL`: canonical public app base URL used to build email verification links safely. Required in production; do not derive it from request `Host` headers.
- `NEXT_PUBLIC_AUTH_MOCK_MODE`: explicitly enables frontend auth mock fallbacks for local development only when set to `true`.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: public Cloudflare Turnstile widget site key used by frontend rendering.
- `SESSION_TTL_HOURS`: server-side auth session and captcha trust lifetime in hours. Defaults to `24` when unset.
- `AUTH_SESSION_SECRET`: server-only HMAC secret used to sign auth session cookies. Required in production; development falls back to a local-only default.
- Email delivery/provider settings are backend-owned and are not configured in this frontend repo. The backend deployment must supply whatever SMTP or email-service variables its implementation requires before registration emails can actually be sent.

## Auth flow overview (starter)

### Backend contract targets

`lib/api/auth.ts` models the backend auth boundary for:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/verify-email?token=...`
- `POST /auth/resend-verification`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`

Frontend routes that keep identity/session decisions on the server:

- `POST /api/auth/session`
- `POST /api/auth/register`
- `POST /api/auth/verify-email`

### Starter session model

- Frontend stores a server-issued signed session cookie (`starter_auth_session`) and trusted captcha cookie (`starter_captcha_trusted`).
- Session and captcha trust lifetime are controlled by `SESSION_TTL_HOURS` and default to 24 hours.
- Role split remains `user` / `admin`.
- `proxy.ts` enforces only guest-only access to auth forms.
- `/dashboard` and `/admin/dashboard` perform server-side session checks on each request, so full page reloads keep valid sessions.
- Login session creation happens in `app/api/auth/session/route.ts`, where the server calls the backend auth API and derives the redirect target from the backend-owned user role/status.

### Email verification contract

- Register submits to `POST /api/auth/register`, which validates input, rejects client-supplied privilege fields, and forwards a safe `verificationUrl` template to the backend.
- Backend must replace `{token}` in that `verificationUrl` with its issued token and send the final email.
- `/verify-email` reads `token` from query string and submits it to `POST /api/auth/verify-email`, which sends the token to the backend for validation.
- If backend verification returns an authenticated active+verified user, the frontend creates the signed 24-hour session server-side and redirects to the role dashboard.
- Otherwise the frontend clears any pending session and redirects to `/login?verified=1`, requiring a fresh login.
- `/resend-verification` is ready for requesting a new verification message.
- Error/success states are code-based and localizable.
- Registration success stays generic to reduce account-enumeration risk.

## Cloudflare Turnstile widget note

`components/auth/turnstile-widget.tsx` is a safe starter integration point for the Turnstile widget lifecycle.

- It loads the official Cloudflare Turnstile script and renders the widget with the public site key.
- It tracks starter lifecycle states: loading/ready, token received, expired/reset, and error.
- The token is included in auth payloads (`turnstileToken`) for login/register/forgot/reset/resend flows.
- Frontend uses only public site key data (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`).
- **No Cloudflare secret validation is performed in frontend**.
- In production, backend must verify Turnstile tokens server-side.

## i18n foundation

- Supported locales: `en`, `bg`
- Locale cookie: `locale`
- Dictionaries:
  - `lib/i18n/dictionaries/en.ts`
  - `lib/i18n/dictionaries/bg.ts`
- Sections prepared for extension:
  - `common.*`
  - `nav.*`
  - `auth.*`
  - `errors.*`
  - `dashboard.*`
  - `compute.*`
- Add a new language by creating a dictionary file and registering it in `lib/i18n/index.ts`.
- Fallback locale is English (`en`).

## Error-code-based UI

Frontend maps backend auth error codes to localized copy (see `lib/auth/errors.ts`), including starter support for:

- `AUTH_INVALID_CREDENTIALS`
- `AUTH_EMAIL_NOT_VERIFIED`
- `AUTH_ACCOUNT_SUSPENDED`
- `AUTH_EMAIL_ALREADY_EXISTS`
- `AUTH_WEAK_PASSWORD`
- `AUTH_BOT_PROTECTION_FAILED`
- `AUTH_INVALID_VERIFY_TOKEN`
- `AUTH_VERIFY_TOKEN_EXPIRED`

## Backend responsibility note

This starter does **not** implement real authentication backend logic or email delivery.

Backend must own:

- user persistence and password policy
- email verification token issuance/expiry
- replacement of `{token}` inside the `verificationUrl` template passed by `POST /api/auth/register`
- delivery of registration / verification emails through the backend's configured mail provider
- reset-password token issuance/expiry
- Cloudflare Turnstile secret validation
- real `/auth/me` session and authorization checks

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```
