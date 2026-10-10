"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type Turnstile = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
export function EmailBotProof({
  onToken,
}: {
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    const api = window.turnstile;
    if (!ready || !sitekey || !api || !container.current) return;
    let active = true;
    const token = (value: string) => {
      if (active) onToken(value);
    };
    const id = api.render(container.current, {
      sitekey,
      action: "verify-email",
      callback: token,
      "expired-callback": () => token(""),
      "error-callback": () => token(""),
    });
    return () => {
      active = false;
      api.remove(id);
    };
  }, [ready, sitekey, onToken]);
  if (!sitekey)
    return (
      <p role="status">
        Email verification is not available yet. You can continue as a guest.
      </p>
    );
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
        onError={() => onToken("")}
      />
      <div ref={container} aria-label="Email security check" />
    </>
  );
}
