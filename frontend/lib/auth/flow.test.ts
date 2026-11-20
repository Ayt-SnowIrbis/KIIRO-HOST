import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmailVerificationUrlTemplate,
  normalizeRegistrationAck,
  normalizeVerificationAck,
  resolvePostVerificationRedirect,
  validateRegistrationRoutePayload,
  validateVerificationRoutePayload,
} from "./flow";
import { getPostLoginRedirectPath, getProtectedSessionRedirectPath } from "./session";
import { getApiBaseUrl, getPublicAppUrl, isAuthMockModeEnabled } from "../config";

test("registration payload rejects server-owned identity fields", () => {
  const result = validateRegistrationRoutePayload({
    email: "user@example.com",
    password: "supersecret",
    turnstileToken: "token",
    role: "admin",
  });

  assert.equal(result.ok, false);
});

test("registration payload normalizes safe user input", () => {
  const result = validateRegistrationRoutePayload({
    email: " User@Example.com ",
    password: "supersecret",
    displayName: " User ",
    turnstileToken: " token ",
  });

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(result.payload, {
      email: "user@example.com",
      password: "supersecret",
      displayName: "User",
      turnstileToken: "token",
    });
  }
});

test("registration response validation fails closed on malformed backend identity", () => {
  assert.equal(
    normalizeRegistrationAck({
      verificationRequired: true,
      user: {
        id: 123,
        email: "user@example.com",
        role: "admin",
        status: "active",
        emailVerified: true,
      },
    }),
    null,
  );
});

test("verification response accepts explicit backend success states only", () => {
  assert.deepEqual(normalizeVerificationAck({ success: true }), { success: true });
  assert.equal(normalizeVerificationAck({ success: false }), null);
});

test("verification payload validation requires a token and preserves safe next paths", () => {
  assert.equal(validateVerificationRoutePayload({ next: "/dashboard" }).ok, false);

  const result = validateVerificationRoutePayload({
    token: " verify-token ",
    next: "/dashboard?tab=billing",
  });

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(result.payload, {
      token: "verify-token",
      next: "/dashboard?tab=billing",
    });
  }
});

test("pending sessions stay out of protected dashboards until verified", () => {
  assert.equal(
    getProtectedSessionRedirectPath(
      {
        role: "user",
        status: "pending_verification",
        emailVerified: false,
      },
      "user",
    ),
    "/verify-email",
  );
});

test("verified sessions route to the correct dashboard", () => {
  assert.equal(
    getPostLoginRedirectPath({
      role: "user",
      status: "active",
      emailVerified: true,
    }),
    "/dashboard",
  );
  assert.equal(
    getPostLoginRedirectPath({
      role: "admin",
      status: "active",
      emailVerified: true,
    }),
    "/admin/dashboard",
  );
});

test("post-verification redirect ignores unsafe next targets", () => {
  assert.equal(
    resolvePostVerificationRedirect(
      {
        role: "user",
        status: "active",
        emailVerified: true,
      },
      "https://evil.example/steal",
    ),
    "/dashboard",
  );
  assert.equal(
    resolvePostVerificationRedirect(
      {
        role: "user",
        status: "active",
        emailVerified: true,
      },
      "/dashboard?tab=billing",
    ),
    "/dashboard?tab=billing",
  );
});

test("production never enables auth mock mode", () => {
  assert.equal(isAuthMockModeEnabled("production", "true"), false);
  assert.equal(isAuthMockModeEnabled("development", "true"), true);
});

test("public app URL template is built from configured origin instead of request headers", () => {
  assert.equal(
    buildEmailVerificationUrlTemplate("https://host.kiirovpn.com/panel"),
    "https://host.kiirovpn.com/panel/verify-email?token=%7Btoken%7D",
  );
});

test("production requires explicit backend and public app URLs", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalApiBaseUrl = process.env.API_BASE_URL;
  const originalPublicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete env[key];
      return;
    }

    env[key] = value;
  };

  try {
    env.NODE_ENV = "production";
    delete env.API_BASE_URL;
    delete env.NEXT_PUBLIC_API_BASE_URL;
    delete env.NEXT_PUBLIC_APP_URL;

    assert.throws(() => getApiBaseUrl());
    assert.throws(() => getPublicAppUrl());
  } finally {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("API_BASE_URL", originalApiBaseUrl);
    restoreEnv("NEXT_PUBLIC_API_BASE_URL", originalPublicApiBaseUrl);
    restoreEnv("NEXT_PUBLIC_APP_URL", originalPublicAppUrl);
  }
});
