"use client";
import { Suspense, useState, useRef, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { startSyntheticCheckout } from "@/services/confirmation";
import { ProtectedConfirmation } from "@/features/booking/protected-confirmation";
function Experiment() {
  const params = useSearchParams(),
    router = useRouter();
  const id = params.get("attempt");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  if (id)
    return <ProtectedConfirmation attemptId={id} checkoutMode="synthetic" />;
  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    controller.current = new AbortController();
    try {
      const attemptId = await startSyntheticCheckout(controller.current.signal);
      if (!controller.current.signal.aborted)
        router.replace(`/experiment/?attempt=${attemptId}`);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="status-shell">
      <section className="surface confirmation-card">
        <p className="payment-foot">Experiment 1 · Synthetic Preview</p>
        <h1>Separate checkout preview</h1>
        <p>
          Keep SoccerBot open while you try a simulated checkout separately. No
          payment details are collected, and no real booking or payment is made.
        </p>
        <p>
          This demonstration requires the isolated local Preview server. Your
          current booking selections and contact information stay unchanged.
        </p>
        <button
          className="button wide"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy ? "Preparing preview…" : "Start synthetic checkout"}
        </button>
        {error && (
          <p role="alert">
            Synthetic checkout is unavailable on this host. Use the documented
            local Preview server.
          </p>
        )}
      </section>
    </div>
  );
}
export default function ExperimentPage() {
  return (
    <Suspense fallback={<p>Preparing preview…</p>}>
      <Experiment />
    </Suspense>
  );
}
