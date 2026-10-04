"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ADDRESS, CONTACT, INSTRUCTORS, SERVICE_NAME } from "@/domain/catalog";
import { money } from "@/domain/dates";
import { downloadBooking, downloadCalendar } from "@/services/exports";
import { useBooking } from "./provider";
import { SessionList } from "./summary";
import { Arrival, ParticipantSummary } from "./review-step";
export function ConfirmationStep() {
  const { attempt, reset } = useBooking(),
    router = useRouter(),
    booking = attempt?.booking;
  const [error, setError] = useState(""),
    [downloading, setDownloading] = useState(false);
  if (!booking) return null;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <Icon name="check" className="h-8 w-8" />
        </span>
        <h1 className="page-title">Booking confirmed</h1>
        <p className="mt-4 text-sm text-muted">
          Booking reference{" "}
          <strong className="text-ink">{booking.reference}</strong>
        </p>
      </div>
      <section className="surface mb-5">
        <h2 className="text-2xl">Download the SoccerBot Player App</h2>
        <p className="mt-3 text-sm text-muted">
          Create your player profile before arrival and have your player QR card
          ready.
        </p>
        <a
          className="button mt-5"
          href="https://soccerbot360.com/en/player-app"
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="download" />
          Get the Player App
        </a>
      </section>
      <section className="surface">
        <h2 className="text-2xl">{SERVICE_NAME}</h2>
        <SessionList slots={booking.slots} />
        <div className="space-y-4 border-t border-line py-5 text-sm">
          <p>
            <strong>Studio 1</strong>
            <br />
            Instructor:{" "}
            {booking.draft.instructor &&
              INSTRUCTORS[booking.draft.instructor].name}
            <br />
            {ADDRESS}
          </p>
          <p>
            {booking.draft.players} players per session · Full instructor
            guidance
          </p>
          <p className="break-words">
            {booking.draft.contact.name}
            <br />
            {booking.draft.contact.email}
          </p>
        </div>
        <details>
          <summary className="py-3 text-sm font-bold">
            Participant and session details
          </summary>
          <ParticipantSummary contact={booking.draft.contact} />
        </details>
        <div className="mt-5 flex justify-between border-t border-line pt-5">
          <span className="rounded bg-emerald-50 px-3 py-1 text-sm text-emerald-800">
            Paid · Preview
          </span>
          <strong>{money(booking.totalCents)}</strong>
        </div>
        <Arrival />
        <p className="mt-4 text-xs text-muted">
          Payment preview · No money was charged.
        </p>
      </section>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button className="button" onClick={() => downloadCalendar(booking)}>
          <Icon name="calendar" />
          Add to calendar
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
          {downloading ? "Preparing download…" : "Download booking details"}
        </button>
        <button
          className="button secondary"
          onClick={() => {
            reset();
            router.push("/book/account/");
          }}
        >
          <Icon name="plus" />
          Make another booking
        </button>
        <a className="button secondary" href={`tel:${CONTACT.phone}`}>
          <Icon name="phone" />
          Need help?
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
