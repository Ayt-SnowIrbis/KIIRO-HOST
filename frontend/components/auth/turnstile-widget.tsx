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

export default function TurnstileWidget({
  value,
  onChange,
  onError,
  onExpire,
  theme = "auto",
  size = "normal",
}: TurnstileWidgetProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const reactId = useId();
  const containerId = `turnstile-${reactId.replace(/:/g, "")}`;
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const widgetIdRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onErrorRef = useRef(onError);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onChangeRef.current = onChange;
    onErrorRef.current = onError;
    onExpireRef.current = onExpire;
  }, [onChange, onError, onExpire]);

  useEffect(() => {
    if (!siteKey || !scriptLoaded || !window.turnstile) return;
    const container = document.getElementById(containerId);
    if (!container) return;

    const widgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      theme,
      size,
      callback: (token) => onChangeRef.current(token),
      "expired-callback": () => {
        onChangeRef.current("");
        onExpireRef.current?.();
      },
      "error-callback": () => {
        onChangeRef.current("");
        onErrorRef.current?.();
      },
    });
    widgetIdRef.current = widgetId;

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      onChangeRef.current("");
    };
  }, [containerId, scriptLoaded, siteKey, size, theme]);

  if (!siteKey) return null;

  return (
    <div>
      <Script
        id="cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptLoaded(true)}
      />
      <div id={containerId} className="min-h-[65px]" />
    </div>
  );
}

export { TurnstileWidget };
