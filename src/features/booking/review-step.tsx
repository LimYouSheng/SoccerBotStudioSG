"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { Dialog } from "@/components/dialog";
import { AGE_GROUPS, INSTRUCTORS, SERVICE_NAME } from "@/domain/catalog";
import { normalizeContact, type ContactDetails } from "@/domain/contact";
import { useBooking } from "./provider";
import { PriceSummary, SessionList } from "./summary";
export function ParticipantSummary({ contact }: { contact: ContactDetails }) {
  const c = normalizeContact(contact);
  return (
    <div className="grid gap-5 border-t border-line py-5 text-sm sm:grid-cols-2">
      <div>
        <h3 className="mb-2 font-bold">Participants</h3>
        <p>
          {c.self ? c.name : c.participant}
          <br />
          {AGE_GROUPS[c.ageGroup as keyof typeof AGE_GROUPS]}
        </p>
        {c.additionalParticipants && <p>{c.additionalParticipants}</p>}
      </div>
      <div>
        <h3 className="mb-2 font-bold">Emergency contact</h3>
        <p>
          {c.emergencyName}
          <br />
          {c.emergencyPhone}
        </p>
      </div>
      {(c.requirements || c.notes) && (
        <div className="sm:col-span-2">
          <h3 className="mb-2 font-bold">Session requirements</h3>
          <p className="whitespace-pre-wrap">
            {c.requirements}
            <br />
            {c.notes}
          </p>
        </div>
      )}
    </div>
  );
}
export function Arrival() {
  return (
    <section className="mt-5 rounded-lg bg-slate-100 p-5 text-sm">
      <h3 className="mb-2 font-bold">Before your session</h3>
      <p>
        <strong>Arrive 10 minutes early.</strong> Late arrival may shorten your
        session. Follow the instructor’s directions and have your Player App
        profile ready.
      </p>
    </section>
  );
}
export function ReviewStep() {
  const { draft, update, checkout } = useBooking(),
    router = useRouter();
  const [error, setError] = useState(""),
    [policy, setPolicy] = useState(false),
    [conflict, setConflict] = useState(false);
  return (
    <>
      <h1 className="page-title">Review booking</h1>
      <p className="mt-3 mb-7 text-muted">Check your details before payment.</p>
      <section className="surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl">{SERVICE_NAME}</h2>
            <p className="mt-2 text-sm">
              {draft.players} players per session · Full instructor guidance
            </p>
          </div>
          <Link className="text-link shrink-0" href="/book/session/">
            Edit players
          </Link>
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Dates & times</h3>
            <Link href="/book/time/" className="text-link">
              Edit selections
            </Link>
          </div>
          <SessionList slots={draft.slots} />
        </div>
        <div className="flex items-start justify-between border-t border-line py-5">
          <div>
            <h3 className="mb-2 font-bold">Instructor</h3>
            <p className="text-sm">
              {draft.instructor && INSTRUCTORS[draft.instructor].name}
            </p>
          </div>
          <Link href="/book/time/" className="text-link">
            Edit instructor
          </Link>
        </div>
        <div className="flex justify-between gap-4 border-t border-line py-5">
          <div className="min-w-0">
            <h3 className="mb-2 font-bold">Booking contact</h3>
            <p className="break-words text-sm">
              {draft.contact.name}
              <br />
              {draft.contact.email}
              <br />
              {draft.contact.phone}
            </p>
          </div>
          <Link href="/book/details/" className="text-link shrink-0">
            Edit details
          </Link>
        </div>
        <ParticipantSummary contact={draft.contact} />
        <PriceSummary draft={draft} />
        <Arrival />
      </section>
      <label className="mt-7 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={draft.accepted}
          onChange={(e) => update({ accepted: e.target.checked })}
        />
        <span>
          I’ve reviewed all selected dates and times and the{" "}
          <button className="underline" onClick={() => setPolicy(true)}>
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
      <button
        className="button mt-6"
        disabled={!draft.accepted}
        onClick={() => {
          try {
            checkout(conflict);
            router.push("/book/payment/");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Continue to payment <Icon name="arrow" />
      </button>
      <details className="mt-7 text-xs text-muted">
        <summary>Preview controls</summary>
        <label className="mt-3 flex gap-2">
          <input
            type="checkbox"
            checked={conflict}
            onChange={(e) => setConflict(e.target.checked)}
          />
          Final slot taken before payment
        </label>
      </details>
      {policy && (
        <Dialog title="Booking information" onClose={() => setPolicy(false)}>
          <div className="space-y-4 text-sm">
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
