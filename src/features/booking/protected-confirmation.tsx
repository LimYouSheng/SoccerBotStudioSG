"use client";
import { useEffect, useState } from "react";
import { readConfirmation } from "@/services/confirmation";
type View = "checking" | "confirmed" | "unavailable" | "unresolved";
export function ProtectedConfirmation({ attemptId }: { attemptId: string }) {
  const [result, setResult] = useState<{
    attemptId: string;
    view: View;
  } | null>(null);
  const view = result?.attemptId === attemptId ? result.view : "checking";
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 600000;
    async function poll() {
      try {
        const decision = await readConfirmation(attemptId, controller.signal);
        if (!active) return;
        if (decision.status === "confirmed")
          setResult({ attemptId, view: "confirmed" });
        else if (decision.status === "pending" && Date.now() < deadline)
          timer = setTimeout(() => {
            void poll();
          }, 5000);
        else setResult({ attemptId, view: "unresolved" });
      } catch {
        if (active) setResult({ attemptId, view: "unavailable" });
      }
    }
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [attemptId]);
  return (
    <div className="status-shell">
      <section className="surface confirmation-card" aria-live="polite">
        <h1>
          {view === "checking"
            ? "Checking your payment and booking…"
            : view === "confirmed"
              ? "Booking confirmed"
              : view === "unresolved"
                ? "Your booking needs review"
                : "Confirmation unavailable"}
        </h1>
        <p>
          {view === "confirmed"
            ? "Your payment and booking have been verified."
            : view === "checking"
              ? "Please wait while we verify your booking."
              : "We could not verify this booking. Please contact the studio before trying another payment."}
        </p>
      </section>
    </div>
  );
}
