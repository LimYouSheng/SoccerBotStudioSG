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
const Loading = createContext<((label: string) => () => void) | null>(null);

// Keep the active screen mounted: loading must not discard contact, consent,
// provider widgets or an in-flight attempt. Multiple reads share one overlay.
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
              message={loadingMessage}
            />
          </div>,
          document.body,
        )}
    </Loading.Provider>
  );
}
export function BookingLoading({
  label = "Preparing your booking…",
}: {
  label?: string;
  compact?: boolean;
  overlay?: boolean;
}) {
  const register = useContext(Loading);
  useEffect(() => register?.(label), [register, label]);
  // A standalone screen can still render the same loading presentation.
  return register ? (
    <span className="sr-only">{label}</span>
  ) : (
    <BrandLoading label={label} message={loadingMessage} />
  );
}
