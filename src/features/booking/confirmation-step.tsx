"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ADDRESS, CONTACT } from "@/domain/catalog";
import { PRICE_CENTS, SERVICE_NAME } from "@/domain/demo-catalog";
import { dateLabel, endTime, money } from "@/domain/dates";
import { downloadBooking, downloadCalendar } from "@/services/exports";
import { useBooking } from "./provider";
import { SessionList } from "./summary";
import { Arrival, ClientDetails } from "./review-step";
export function ConfirmationStep() {
  const { attempt, reset } = useBooking(),
    router = useRouter(),
    booking = attempt?.booking;
  const [error, setError] = useState(""),
    [downloading, setDownloading] = useState(false);
  if (!booking) return null;
  return (
    <div className="status-shell">
      <div className="status-heading">
        <span className="status-icon">
          <Icon name="check" />
        </span>
        <h1>Booking confirmed</h1>
        <p className="reference">
          Booking reference{" "}
          <strong className="text-ink">{booking.reference}</strong>
        </p>
      </div>
      <section className="surface confirmation-card">
        <section
          className="confirmation-section"
          aria-labelledby="confirmation-client"
        >
          <h2 className="section-title" id="confirmation-client">
            Client Details
          </h2>
          <ClientDetails contact={booking.draft.contact} />
        </section>
        <section
          className="confirmation-section"
          aria-labelledby="confirmation-sessions"
        >
          <h2 className="section-title" id="confirmation-sessions">
            Session Details
          </h2>
          <p className="confirmation-service">
            <strong>{SERVICE_NAME}</strong>
            <br />
            {booking.draft.players}{" "}
            {booking.draft.players === 1 ? "player" : "players"} per session ·
            40 minutes · Singapore time
          </p>
          <SessionList slots={booking.slots} showRotation={false} />
        </section>
        <section
          className="confirmation-section"
          aria-labelledby="confirmation-location"
        >
          <h2 className="section-title" id="confirmation-location">
            Location
          </h2>
          <p>
            <strong>
              {[...new Set(booking.slots.map((slot) => slot.studio))].join(
                ", ",
              )}
            </strong>
            <br />
            {ADDRESS}
          </p>
        </section>
        <section
          className="confirmation-section"
          aria-labelledby="confirmation-amount"
        >
          <h2 className="section-title" id="confirmation-amount">
            Amount
          </h2>
          <div className="paid">
            <span className="pill success">Paid · Preview</span>
            <strong>{money(booking.totalCents)}</strong>
          </div>
          <p className="hint">
            {booking.slots.length} × {money(PRICE_CENTS)} · SGD · Inclusive of
            GST
          </p>
        </section>
        <section
          className="confirmation-section"
          aria-labelledby="confirmation-disclaimers"
        >
          <h2 className="section-title" id="confirmation-disclaimers">
            Disclaimers
          </h2>
          {booking.slots
            .filter((slot) => slot.rotationAt)
            .map((slot) => (
              <p className="rotation-notice" key={`${slot.date}|${slot.start}`}>
                {dateLabel(slot.date)}, {slot.start}–{endTime(slot.start)}:
                Crosses the {slot.rotationAt} instructor rotation. Your assigned
                instructor stays for the full session.
              </p>
            ))}
          <Arrival />
          <p className="hint">
            Follow your instructor’s safety guidance. Contact the studio for
            changes, cancellations or refund enquiries.
          </p>
          <p className="payment-foot">
            Payment preview · No money was charged.
          </p>
        </section>
      </section>
      <div className="confirmation-actions" aria-label="Booking actions">
        <button className="button" onClick={() => downloadCalendar(booking)}>
          <Icon name="calendar" />
          <span>Add to calendar</span>
        </button>
        <button
          className="button"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await downloadBooking(booking);
            } catch {
              setError("The download could not be created. Please try again.");
            } finally {
              setDownloading(false);
            }
          }}
        >
          <Icon name="download" />
          <span>
            {downloading ? "Preparing download…" : "Download booking details"}
          </span>
        </button>
        <button
          className="button secondary"
          onClick={() => {
            reset();
            router.push("/book/account/");
          }}
        >
          <Icon name="plus" />
          <span>Make another booking</span>
        </button>
        <a className="button secondary" href={`tel:${CONTACT.phone}`}>
          <Icon name="phone" />
          <span>Need help?</span>
        </a>
      </div>
      {error && (
        <p className="alert mt-4" role="alert">
          {error}
        </p>
      )}
      <Link href="/" className="text-link mt-5">
        Back to home
      </Link>
    </div>
  );
}
