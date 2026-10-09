"use client";
import { useEffect, useState } from "react";
import { protectedCheckoutService } from "@/services/confirmation";
import type { CheckoutContext } from "@/services/contracts";
import { money } from "@/domain/dates";
import { useConfirmationChecking } from "./confirmation-checking";
export function ProtectedConfirmation({
  attemptId,
  checkoutMode,
  sessionRevision = 0,
}: {
  attemptId: string;
  checkoutMode?: "synthetic" | "live";
  sessionRevision?: number;
}) {
  const { view, busy, check, bindWindow } = useConfirmationChecking(
    attemptId,
    sessionRevision,
  );
  const [context, setContext] = useState<{
    value: CheckoutContext;
    revision: number;
  } | null>(null);
  const [expiredLink, setExpiredLink] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [preparation, setPreparation] = useState("loading");
  useEffect(() => {
    if (!checkoutMode) return;
    let active = true;
    const controller = new AbortController();
    void protectedCheckoutService
      .context({ attemptId, mode: checkoutMode, signal: controller.signal })
      .then(
        (value) => {
          if (active) {
            bindWindow(value.checking);
            setContext({ value, revision: sessionRevision });
            setPreparation("ready");
          }
        },
        () => {
          if (active) setPreparation("unavailable");
        },
      );
    return () => {
      active = false;
      controller.abort();
    };
  }, [attemptId, checkoutMode, sessionRevision, bindWindow]);
  const current =
    context?.value.attemptId === attemptId &&
    context.value.mode === checkoutMode &&
    context.revision === sessionRevision &&
    view !== "denied"
      ? context.value
      : null;
  const link =
    current?.checkout.state === "available" ? current.checkout : null;
  useEffect(() => {
    if (!link?.expiresAtMs) return;
    const timer = setTimeout(
      () => setExpiredLink(link.url),
      Math.max(0, link.expiresAtMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [link]);
  const showLink =
    current?.checkout.state === "available" &&
    current.checkout.url !== expiredLink &&
    !["confirmed", "denied", "unresolved"].includes(view);
  return (
    <div className="status-shell">
      <section className="surface confirmation-card" aria-live="polite">
        {checkoutMode === "synthetic" && (
          <p className="payment-foot">
            Experiment 1 · Synthetic Preview · No payment or booking is made
          </p>
        )}
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
            : view === "denied"
              ? "Your access has expired or was revoked. Contact the studio to recover access before trying another payment."
              : view === "checking"
                ? "Please wait while we verify your booking."
                : view === "unavailable"
                  ? "Status checking is temporarily unavailable. Your information is preserved. You can check again shortly."
                  : "We could not verify this booking. Please contact the studio before trying another payment. The checking deadline does not mean your payment was cancelled."}
        </p>
        {current && (
          <section aria-label="Current booking summary">
            <h2 className="section-title">Your booking</h2>
            <p>
              {current.summary.players} players ·{" "}
              {current.summary.sessions.length} session
              {current.summary.sessions.length === 1 ? "" : "s"}
            </p>
            <ul>
              {current.summary.sessions.map((session, index) => (
                <li key={index}>
                  {new Intl.DateTimeFormat("en-SG", {
                    timeZone: "Asia/Singapore",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(session.startMs)}{" "}
                  · {session.players} players
                </li>
              ))}
            </ul>
            <p className="line-item total">
              Total <strong>{money(current.summary.totalMinor)}</strong>
            </p>
          </section>
        )}
        {checkoutMode && (
          <>
            <p>
              Checkout opens separately. Your browser may use a tab or window.
              Return to SoccerBot to check progress; opening or closing checkout
              does not confirm payment.
            </p>
            {showLink && current?.checkout.state === "available" ? (
              <a
                className="button wide"
                href={current.checkout.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                onClick={(event) => {
                  if (link?.expiresAtMs && Date.now() >= link.expiresAtMs) {
                    event.preventDefault();
                    setExpiredLink(link.url);
                  } else setOpened(attemptId);
                }}
              >
                {opened === attemptId ? "Open checkout again" : "Open checkout"}
              </a>
            ) : view === "checking" || view === "unavailable" ? (
              <p role="status">
                {preparation === "loading"
                  ? "Preparing checkout…"
                  : "Checkout unavailable. Do not start another payment."}
              </p>
            ) : null}
          </>
        )}
        {!["confirmed", "unresolved", "denied"].includes(view) && (
          <button
            className="button secondary wide payment-status-action"
            disabled={busy}
            onClick={check}
          >
            {busy ? "Checking status…" : "Check status"}
          </button>
        )}
      </section>
    </div>
  );
}
