"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { CONTACT, SERVICE_NAME } from "@/domain/catalog";
import { type Outcome, totalCents } from "@/domain/booking";
import { money } from "@/domain/dates";
import { useBooking } from "./provider";
import { SessionList } from "./summary";
export function PaymentStep() {
  const { attempt, pay, check } = useBooking(),
    [method, setMethod] = useState("card"),
    [outcome, setOutcome] = useState<Outcome>("success");
  if (!attempt) return null;
  const waiting = ["checking", "pending", "late"].includes(attempt.status),
    checking = attempt.status === "checking",
    late = attempt.status === "late";
  if (waiting)
    return (
      <div className="mx-auto max-w-xl">
        <div role="status" className="mb-8 text-center">
          <Icon
            name={checking ? "clock" : late ? "lock" : "clock"}
            className={`mx-auto mb-5 h-14 w-14 text-action ${checking ? "animate-pulse" : ""}`}
          />
          <h1 className="page-title">
            {checking
              ? "Processing payment"
              : late
                ? "Payment under review"
                : "Payment pending"}
          </h1>
          <p className="mt-5 text-muted">
            {checking
              ? "Please give us a moment to confirm your payment and booking."
              : late
                ? "The payment arrived after the reservation expired, or availability needs review. Contact the studio before making another payment."
                : "Your payment is still processing. Please avoid starting another payment."}
          </p>
        </div>
        <section className="surface">
          <h2 className="text-xl">{SERVICE_NAME}</h2>
          <SessionList slots={attempt.draft.slots} />
          <div className="my-5 flex justify-between">
            <span>Payment amount</span>
            <strong>{money(totalCents(attempt.draft))}</strong>
          </div>
          {late ? (
            <a className="button w-full" href={`tel:${CONTACT.phone}`}>
              Contact the studio <Icon name="phone" />
            </a>
          ) : (
            <button
              className="button w-full"
              disabled={checking}
              onClick={check}
            >
              {checking ? "Checking payment…" : "Check payment status"}
            </button>
          )}
        </section>
      </div>
    );
  return (
    <>
      <Link className="back mb-8" href="/book/review/">
        <Icon name="back" />
        Back to your booking
      </Link>
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <div className="mb-6 flex items-center gap-3 text-sm font-bold">
            <Icon name="ball" />
            SOCCERBOTSTUDIO Singapore
          </div>
          <h1 className="page-title">Payment</h1>
          <p className="mt-4 text-sm text-muted">
            Total due · SGD · Inclusive of GST
          </p>
          <strong className="mt-3 block text-5xl">
            {money(totalCents(attempt.draft))}
          </strong>
          <h2 className="mt-9 text-xl">{SERVICE_NAME}</h2>
          <p className="mt-3 text-sm text-muted">
            {attempt.draft.players} players · Instructor included
          </p>
          <SessionList slots={attempt.draft.slots} />
        </section>
        <section className="surface" aria-label="Checkout">
          {attempt.status === "declined" && (
            <p className="alert mb-6" role="alert">
              Your payment wasn’t completed. No charge was made. Try again or
              return to your booking.
            </p>
          )}
          <h2 className="text-2xl">Payment method</h2>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {["card", "paynow"].map((value) => (
              <button
                key={value}
                className={`rounded-lg border p-4 font-bold ${method === value ? "border-action bg-slate-100" : "border-line"}`}
                aria-pressed={method === value}
                onClick={() => setMethod(value)}
              >
                {value === "card" ? "Card" : "PayNow"}
              </button>
            ))}
          </div>
          <div className="my-7 grid min-h-40 place-content-center rounded-xl bg-slate-100 text-center">
            <Icon
              name={method === "card" ? "lock" : "phone"}
              className="mx-auto mb-4 h-10 w-10"
            />
            <h3 className="font-bold">
              {method === "card" ? "Card payment" : "PayNow"}
            </h3>
            <p className="mt-2 text-xs text-muted">Hosted payment preview</p>
          </div>
          <button className="button w-full" onClick={() => pay(outcome)}>
            Pay {money(totalCents(attempt.draft))}
          </button>
          <p className="mt-4 text-center text-xs text-muted">
            Payment preview · No money will be charged.
          </p>
          <details className="mt-7 text-xs text-muted">
            <summary>Preview controls</summary>
            <label htmlFor="payment-outcome" className="mt-3 block">
              Payment outcome
            </label>
            <select
              id="payment-outcome"
              className="field-control mt-2"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as Outcome)}
            >
              <option value="success">Successful payment</option>
              <option value="declined">Payment declined</option>
              <option value="pending">Payment processing</option>
              <option value="late">Payment received after expiry</option>
            </select>
          </details>
        </section>
      </div>
    </>
  );
}
