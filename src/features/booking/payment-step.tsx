"use client";
import { BookingLoading as BrandLoading } from "./booking-loading";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { CONTACT } from "@/domain/catalog";
import { SERVICE_NAME } from "@/domain/demo-catalog";
import { totalCents } from "@/domain/booking";
import { money } from "@/domain/dates";
import { useBooking } from "./provider";
import { SessionList } from "./summary";
import { ProtectedConfirmation } from "./protected-confirmation";
export function PaymentStep() {
  const {
    attempt,
    pay,
    check,
    resolve,
    action,
    cancel,
    bookingService,
    revision,
    reset,
  } = useBooking();
  const [method, setMethod] = useState("card");
  useEffect(() => () => cancel(), [cancel]);
  const error = action.error;
  const busy = action.status === "loading";
  if (!attempt) return null;
  if (bookingService.mode === "live") {
    if (attempt.status !== "ready")
      return (
        <ProtectedConfirmation
          attemptId={attempt.id}
          checkoutMode="live"
          sessionRevision={revision}
          onAgain={reset}
        />
      );
    return (
      <div className="payment-shell">
        <div className="booking-top">
          <Link className="back" href="/book/review/">
            <Icon name="back" /> Back to review
          </Link>
        </div>
        <div className="payment-layout">
          <section
            className="surface payment-summary"
            aria-label="Order summary"
          >
            <div className="payment-merchant">
              <span className="merchant-icon">
                <Icon name="ball" />
              </span>
              SOCCERBOTSTUDIO Singapore
            </div>
            <h1 className="payment-title">Payment</h1>
            <p className="text-sm text-muted">Total due · SGD</p>
            <strong className="payment-total block">
              {money(totalCents(attempt.draft))}
            </strong>
            <div className="payment-item">
              <strong>
                {attempt.draft.slots[0]?.native?.serviceName ?? "Your session"}
              </strong>
              <p>{attempt.draft.players} players · Instructor included</p>
              <SessionList slots={attempt.draft.slots} />
            </div>
          </section>
          <section className="surface" aria-label="Checkout">
            <h2 className="section-title">Payment method</h2>
            <div className="payment-demo">
              <Icon name="lock" />
              <h3>Secure payment</h3>
              <p>Choose your payment method at secure checkout.</p>
            </div>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <button
              className="button wide"
              disabled={busy}
              onClick={() => {
                void pay("pending");
              }}
            >
              {busy ? (
                <BrandLoading compact label="Preparing secure checkout…" />
              ) : (
                `Pay ${money(totalCents(attempt.draft))}`
              )}
            </button>
            <p className="payment-foot">
              We check your sessions again before preparing checkout. Payment is
              confirmed only after verification.
            </p>
          </section>
        </div>
      </div>
    );
  }

  const waiting = ["checking", "pending", "late"].includes(attempt.status),
    checking = attempt.status === "checking",
    late = attempt.status === "late";
  if (waiting)
    return (
      <div className="status-shell">
        <div role="status" className="status-heading">
          {checking && !error ? (
            <BrandLoading compact label="Processing payment" />
          ) : (
            <span className="status-icon pending">
              <Icon name={late ? "lock" : "clock"} />
            </span>
          )}
          <h1>
            {checking
              ? "Processing payment"
              : late
                ? "Payment under review"
                : "Payment pending"}
          </h1>
          <p className="text-muted">
            {checking
              ? "Please give us a moment to confirm your payment and booking."
              : late
                ? "The payment arrived after the reservation expired, or availability needs review. Contact the studio before making another payment."
                : "Your payment is still processing. Please avoid starting another payment."}
          </p>
        </div>
        <section className="surface">
          <h2 className="section-title">{SERVICE_NAME}</h2>
          <SessionList slots={attempt.draft.slots} />
          <div className="line-item total">
            <span>Payment amount</span>
            <strong>{money(totalCents(attempt.draft))}</strong>
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {late ? (
            <a
              className="button wide payment-status-action"
              href={`tel:${CONTACT.phone}`}
            >
              Contact the studio <Icon name="phone" />
            </a>
          ) : (
            <button
              className="button wide payment-status-action"
              disabled={busy || (checking && !error)}
              onClick={() => {
                void (checking ? resolve() : check());
              }}
            >
              {busy || (checking && !error) ? (
                <BrandLoading compact label="Checking payment…" />
              ) : (
                "Check payment status"
              )}
            </button>
          )}
        </section>
      </div>
    );
  return (
    <div className="payment-shell">
      <Link className="back" href="/book/review/">
        <Icon name="back" />
        Back to your booking
      </Link>
      <div className="payment-layout">
        <section>
          <div className="payment-merchant">
            <span className="merchant-icon">
              <Icon name="ball" />
            </span>
            SOCCERBOTSTUDIO Singapore
          </div>
          <h1 className="payment-title">Payment</h1>
          <p className="text-sm text-muted">
            Total due · SGD · Inclusive of GST
          </p>
          <strong className="payment-total block">
            {money(totalCents(attempt.draft))}
          </strong>
          <div className="payment-item">
            <strong>{SERVICE_NAME}</strong>
            <p>{attempt.draft.players} players · Instructor included</p>
            <SessionList slots={attempt.draft.slots} />
          </div>
        </section>
        <section className="surface" aria-label="Checkout">
          {attempt.status === "declined" && (
            <p className="alert mb-6" role="alert">
              Your payment wasn’t completed. No charge was made. Try again or
              return to your booking.
            </p>
          )}
          <h2 className="section-title">Payment method</h2>
          <div
            className="payment-methods"
            role="group"
            aria-label="Payment method"
          >
            {["card", "paynow"].map((value) => (
              <button
                key={value}
                className={`method ${method === value ? "selected" : ""}`}
                aria-pressed={method === value}
                onClick={() => setMethod(value)}
              >
                <Icon name={value === "card" ? "card" : "phone"} />
                {value === "card" ? "Card" : "PayNow"}
              </button>
            ))}
          </div>
          <div className="payment-demo">
            <Icon name={method === "card" ? "card" : "phone"} />
            <h3>{method === "card" ? "Card payment" : "PayNow"}</h3>
            <p>Hosted payment preview</p>
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}{" "}
              <Link className="text-link" href="/book/time/">
                Review selections
              </Link>
            </p>
          )}
          <button
            className="button wide"
            disabled={busy}
            onClick={() => {
              void pay("success");
            }}
          >
            {busy ? (
              <BrandLoading compact label="Starting payment…" />
            ) : (
              `Pay ${money(totalCents(attempt.draft))}`
            )}
          </button>
          <p className="payment-foot">
            Payment preview · No money will be charged.
          </p>
          <Link className="text-link" href="/experiment/">
            Try separate checkout · Synthetic Preview
          </Link>
        </section>
      </div>
    </div>
  );
}
