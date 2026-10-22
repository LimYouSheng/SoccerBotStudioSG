"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { BrandLoading } from "@/components/brand-loading";
export const loadingMessage =
  "Please don’t close or refresh this page while we finish.";
const feedbackMessage = (label?: string) =>
  label === "Opening secure payment…" || label === "Verifying your payment…"
    ? `${label} ${loadingMessage}`
    : loadingMessage;
const Loading = createContext<((label: string) => () => void) | null>(null);

// Keep the active screen mounted: loading must not discard contact, consent,
// provider widgets or an in-flight attempt. Multiple reads share one overlay.
/** Share booking loading state across asynchronous operations. */
export function BookingLoadingProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Map<symbol, string>>(() => new Map());
  const register = useCallback((label: string) => {
    const id = Symbol();
    setPending((current) => new Map(current).set(id, label));
    return () =>
      setPending((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
  }, []);
  const busy = pending.size > 0;
  useEffect(() => {
    if (!busy) return;
    const main = document.getElementById("main");
    const wasInert = main?.inert;
    if (main) main.inert = true;
    return () => {
      if (main) main.inert = wasInert ?? false;
    };
  }, [busy]);
  return (
    <Loading.Provider value={register}>
      <div
        style={{ display: "contents" }}
        inert={busy}
        aria-busy={busy || undefined}
      >
        {children}
      </div>
      {busy &&
        createPortal(
          <div className="booking-flow-overlay">
            <BrandLoading
              label={pending.values().next().value}
              message={feedbackMessage(pending.values().next().value)}
            />
          </div>,
          document.body,
        )}
    </Loading.Provider>
  );
}
/** Render the shared booking progress presentation. */
export function BookingLoading({
  label = "Preparing your booking…",
  compact = false,
  overlay = true,
}: {
  label?: string;
  compact?: boolean;
  overlay?: boolean;
}) {
  const register = useContext(Loading);
  useEffect(
    () => (overlay ? register?.(label) : undefined),
    [register, label, overlay],
  );
  // A standalone screen can still render the same loading presentation.
  return register && overlay ? (
    <span className="sr-only">{label}</span>
  ) : (
    <BrandLoading
      compact={compact}
      overlay={overlay}
      label={label}
      message={overlay ? feedbackMessage(label) : undefined}
    />
  );
}
