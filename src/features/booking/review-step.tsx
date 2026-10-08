"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/dialog";
import { selectionErrors } from "@/domain/booking";
import { CONTACT_METHODS, SERVICE_NAME } from "@/domain/catalog";
import { normalizeContact, type ContactDetails } from "@/domain/contact";
import { useBooking } from "./provider";
import { PriceSummary, SessionList } from "./summary";
export function ClientDetails({ contact }: { contact: ContactDetails }) {
  const c = normalizeContact(contact);
  return (
    <dl className="booking-facts client-details">
      <dt>Full name</dt>
      <dd>{c.name}</dd>
      <dt>Email address</dt>
      <dd>{c.email}</dd>
      <dt>Mobile number</dt>
      <dd>{c.phone}</dd>
      <dt>Preferred contact method</dt>
      <dd>
        {CONTACT_METHODS[c.contactMethod as keyof typeof CONTACT_METHODS]}
      </dd>
      {c.academy && (
        <>
          <dt>Academy / school / organisation</dt>
          <dd>{c.academy}</dd>
        </>
      )}
    </dl>
  );
}
export function Arrival() {
  return (
    <section className="arrival-information" aria-label="Before your session">
      <h3>Before your session</h3>
      <p className="arrival-time">
        <strong>Arrive 10 minutes early.</strong>
        <span>Latecomers may not be given extra time.</span>
      </p>
      <p>
        Wear training gear or activewear. Soccer boots are preferred; sports
        shoes are also suitable. Bring your own towel.
      </p>
    </section>
  );
}
export function ReviewStep() {
  const { draft, update, checkout, now, action, cancel } = useBooking(),
    router = useRouter();
  const [policy, setPolicy] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  const error = action.error;
  const busy = action.status === "loading";
  return (
    <>
      <h1 className="page-title">Review booking</h1>
      <p className="lead">Check your details before payment.</p>
      <section className="surface">
        <div className="review-block">
          <div className="review-head">
            <h2>Your sessions</h2>
            <Link className="text-link" href="/book/session/">
              Edit players
            </Link>
          </div>
          <p>
            <strong>{SERVICE_NAME}</strong>
            <br />
            {draft.players} {draft.players === 1 ? "player" : "players"} per
            session · Full instructor guidance
          </p>
        </div>
        <div className="review-block">
          <div className="review-head">
            <h2>Dates &amp; times</h2>
            <Link className="text-link" href="/book/time/">
              Edit selections
            </Link>
          </div>
          <SessionList slots={draft.slots} now={now} />
        </div>
        <div className="review-block">
          <div className="review-head">
            <h2>Booking contact</h2>
            <Link className="text-link" href="/book/details/">
              Edit details
            </Link>
          </div>
          <ClientDetails contact={draft.contact} />
        </div>
        <div className="review-block">
          <h2 className="section-title">Order summary</h2>
          <PriceSummary draft={draft} />
        </div>
        <Arrival />
      </section>
      <label className="check-label review-terms">
        <input
          type="checkbox"

          checked={draft.accepted}
          onChange={(e) => update({ accepted: e.target.checked })}
        />
        <span>
          I’ve reviewed all selected dates and times and the{" "}
          <button className="text-link" onClick={() => setPolicy(true)}>
            booking information
          </button>
          .
        </span>
      </label>
      {error && (
        <div className="alert mt-5" role="alert">
          {error}
          <Link className="text-link ml-3" href="/book/time/">
            Review selections
          </Link>
        </div>
      )}
      <div className="actions">
        <button
          className="button"
          disabled={
            busy ||
            !draft.accepted ||
            selectionErrors(draft.slots, now).length > 0
          }
          onClick={async () => {
            if ((await checkout()) && mounted.current)
              router.push("/book/payment/");
          }}
        >
          {busy ? "Checking your booking…" : "Continue to payment"}{" "}
          <Icon name="arrow" />
        </button>
      </div>
      {policy && (
        <Dialog title="Booking information" onClose={() => setPolicy(false)}>
          <div className="space-y-4">
            <p>
              Each session is 40 minutes for 1–4 players with one instructor in
              the shared studio. Start times are 50 minutes apart.
            </p>
            <p>
              Selecting a time does not reserve it. Availability is checked
              again before payment. Follow the instructor’s safety guidance.
            </p>
            <p>
              Contact the studio for changes, cancellations and applicable
              refund policies. Cancellation and refund are separate actions.
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}
