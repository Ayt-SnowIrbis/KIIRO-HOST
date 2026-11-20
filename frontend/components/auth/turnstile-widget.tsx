"use client";

import Script from "next/script";
import { useEffect, useId, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  value: string;
  onChange: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
}

const TURNSTILE_SESSION_TOKEN_KEY = "turnstile_token";
const TURNSTILE_SESSION_TOKEN_AT_KEY = "turnstile_token_created_at";
const TURNSTILE_TOKEN_TTL_MS = 4 * 60 * 1000;

function getStoredToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const token = window.sessionStorage.getItem(TURNSTILE_SESSION_TOKEN_KEY) ?? "";
  const createdAtRaw =
    window.sessionStorage.getItem(TURNSTILE_SESSION_TOKEN_AT_KEY) ?? "0";
  const createdAt = Number(createdAtRaw);

  if (!token || !createdAt || Number.isNaN(createdAt)) {
    return "";
  }

  if (Date.now() - createdAt > TURNSTILE_TOKEN_TTL_MS) {
    window.sessionStorage.removeItem(TURNSTILE_SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(TURNSTILE_SESSION_TOKEN_AT_KEY);
    return "";
  }

  return token;
}

function storeToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (!token) {
    window.sessionStorage.removeItem(TURNSTILE_SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(TURNSTILE_SESSION_TOKEN_AT_KEY);
    return;
  }

  window.sessionStorage.setItem(TURNSTILE_SESSION_TOKEN_KEY, token);
  window.sessionStorage.setItem(
    TURNSTILE_SESSION_TOKEN_AT_KEY,
    String(Date.now()),
  );
}

function TurnstileWidget({
  value,
  onChange,
  onError,
  onExpire,
  theme = "auto",
  size = "normal",
}: TurnstileWidgetProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerId = `turnstile-${useId().replace(/:/g, "")}`;
  const [scriptLoaded, setScriptLoaded] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const widgetIdRef = useRef<string | null>(null);
  const renderAttemptRef = useRef(false);

  useEffect(() => {
    const storedToken = getStoredToken();
    if (storedToken && !value) {
      onChange(storedToken);
    }
  }, [onChange, value]);

  useEffect(() => {
    if (!siteKey) {
      return;
    }

    if (!scriptLoaded || !window.turnstile) {
      return;
    }

    const storedToken = getStoredToken();
    if (storedToken) {
      if (!value) {
        onChange(storedToken);
      }
      return;
    }

    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }

    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {}
      widgetIdRef.current = null;
    }

    container.innerHTML = "";

    try {
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: siteKey,
        theme,
        size,
        callback: (token: string) => {
          storeToken(token);
          onChange(token);
        },
        "expired-callback": () => {
          storeToken("");
          onChange("");
          onExpire?.();
          if (widgetIdRef.current && window.turnstile) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch {}
          }
        },
        "error-callback": () => {
          storeToken("");
          onChange("");
          onError?.();
        },
      });

      renderAttemptRef.current = true;
    } catch {
      onError?.();
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [containerId, onChange, onError, onExpire, scriptLoaded, siteKey, size, theme, value]);
  if (!siteKey) {
    return null;
  }

  const hasReusableToken = Boolean(value || getStoredToken());

  return (
    <div>
      <Script
        id="cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      {hasReusableToken ? null : (
        <div id={containerId} className="min-h-[65px]" />
      )}
    </div>
  );
}

export { TurnstileWidget };
export default TurnstileWidget;
