"use client";
import { BookingLoading as BrandLoading } from "./booking-loading";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ADDRESS, CONTACT } from "@/domain/catalog";
import { SERVICE_NAME } from "@/domain/demo-catalog";
import { dateLabel, endTime, money } from "@/domain/dates";
import { downloadBooking, downloadCalendar } from "@/services/exports";
import type { Booking } from "@/domain/booking";
import { useBooking } from "./provider";
import { SessionList } from "./summary";
import { Arrival, ClientDetails } from "./review-step";
export function ConfirmationStep() {
  const { attempt, reset } = useBooking(),
    router = useRouter(),
    booking = attempt?.booking;
  if (!booking) return null;
  return (
    <BookingConfirmation
      booking={booking}
      preview
      onAgain={() => {
        reset();
        router.push("/book/account/");
      }}
    />
  );
}
export function BookingConfirmation({
  booking,
  preview = false,
  taxMinor = 0,
  verifiedAtMs,
  onAgain,
  calendarDownload,
  detailsDownload,
}: {
  booking: Booking;
  preview?: boolean;
  taxMinor?: number;
  verifiedAtMs?: number;
  onAgain: () => void;
  calendarDownload?: () => Promise<void>;
  detailsDownload?: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [downloading, setDownloading] = useState(false);
  async function download(operation: () => Promise<void> | void) {
    setDownloading(true);
    setError("");
    try {
      await operation();
    } catch {
      setError("The download could not be created. Please try again.");
    } finally {
      setDownloading(false);
    }
  }
  return (
    <div className="status-shell">
      <div className="status-heading">
        <span className="status-icon">
          <Icon name="check" />
        </span>
        <h1>Booking confirmed</h1>
        {verifiedAtMs !== undefined && (
          <p>
            Saved confirmation · Verified{" "}
            {new Intl.DateTimeFormat("en-SG", {
              timeZone: "Asia/Singapore",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(verifiedAtMs)}{" "}
            (Singapore time)
          </p>
        )}
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
            <strong>
              {booking.slots[0]?.native?.serviceName ?? SERVICE_NAME}
            </strong>
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
            <span className="pill success">
              {preview ? "Paid · Preview" : "Paid"}
            </span>
            <strong>{money(booking.totalCents)}</strong>
          </div>
          <p className="hint">
            {preview
              ? `${booking.slots.length} session${booking.slots.length === 1 ? "" : "s"} · SGD · Inclusive of GST`
              : `SGD · Tax ${money(taxMinor)}`}
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
          {preview && (
            <p className="payment-foot">
              Payment preview · No money was charged.
            </p>
          )}
        </section>
      </section>
      <div className="confirmation-actions" aria-label="Booking actions">
        <button
          className="button"
          disabled={downloading}
          onClick={() =>
            void download(calendarDownload ?? (() => downloadCalendar(booking)))
          }
        >
          <Icon name="calendar" />
          <span>Add to calendar</span>
        </button>
        <button
          className="button"
          disabled={downloading}
          onClick={() =>
            void download(detailsDownload ?? (() => downloadBooking(booking)))
          }
        >
          <Icon name="download" />
          <span>
            {downloading ? (
              <BrandLoading compact label="Preparing download…" />
            ) : (
              "Download booking details"
            )}
          </span>
        </button>
        <button className="button secondary" onClick={onAgain}>
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
      <Link href="/" className="text-link mt-5 block text-center">
        Back to home
      </Link>
    </div>
  );
}
