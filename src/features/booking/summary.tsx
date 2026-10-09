"use client";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { INSTRUCTORS, PRICE_CENTS, SERVICE_NAME } from "@/domain/demo-catalog";
import {
  orderedSlots,
  isElapsed,
  selectionErrors,
  slotKey,
  totalCents,
  type BookingDraft,
  type Session,
} from "@/domain/booking";
import { dateLabel, endTime, money } from "@/domain/dates";
import { bookingCover } from "@/content/media";
import { InstructorProfile } from "./instructor";
import { useBooking } from "./provider";
export function SessionList({
  slots,
  remove,
  showRotation = true,
  now,
}: {
  slots: Session[];
  now?: number;
  showRotation?: boolean;
  remove?: (slot: Session) => void;
}) {
  const list = (
    <ol
      className={remove ? "basket-list" : "series-list"}
      aria-label="Selected sessions"
      tabIndex={0}
    >
      {orderedSlots(slots).map((slot, index) => {
        return (
          <li key={slotKey(slot)}>
            {!remove && <span className="series-index">{index + 1}</span>}
            <div className={remove ? undefined : "series-date"}>
              <strong>{dateLabel(slot.date)}</strong>
              <span>
                {slot.start}–{endTime(slot.start)} SGT
              </span>
              <span className="session-instructor">
                {INSTRUCTORS[slot.instructor].name}
              </span>
              {showRotation && slot.rotationAt && (
                <span className="rotation-notice">
                  Crosses the {slot.rotationAt} instructor rotation. Your
                  assigned instructor stays for the full session.
                </span>
              )}
              {now !== undefined && isElapsed(slot, now) && (
                <span className="field-error">
                  Session has started — remove to continue.
                </span>
              )}
              {remove && <small>{money(PRICE_CENTS)}</small>}
            </div>
            {remove && (
              <button
                className="basket-remove"
                aria-label={`Remove ${slot.date} at ${slot.start}`}
                onClick={() => remove(slot)}
              >
                <Icon name="close" />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
  return list;
}

export function PriceSummary({ draft }: { draft: BookingDraft }) {
  return (
    <div className="price-breakdown">
      <div className="line-item">
        <span>
          {draft.slots.length} × 40 min session
          <small>{money(PRICE_CENTS)} each</small>
        </span>
        <strong>{money(totalCents(draft))}</strong>
      </div>
      <div className="line-item total">
        <span>Total due</span>
        <strong>{money(totalCents(draft))}</strong>
      </div>
      <p className="hint">SGD · Inclusive of GST</p>
    </div>
  );
}
export function Summary({ basket = false }: { basket?: boolean }) {
  const { draft, update, now, availability } = useBooking();
  const result = availability.result;
  const valid =
    selectionErrors(draft.slots, now).length === 0 &&
    result?.status === "success" &&
    draft.slots.every((slot) =>
      result.slots.some(
        (available) =>
          slotKey(available) === slotKey(slot) &&
          available.available &&
          available.instructor === slot.instructor &&
          available.rotationAt === slot.rotationAt,
      ),
    );
  const instructors = [
    ...new Set(orderedSlots(draft.slots).map((slot) => slot.instructor)),
  ];
  return (
    <div className="aside-wrap">
      <aside className="summary" aria-label="Your booking summary">
        <div
          className="summary-cover"
          style={{ backgroundImage: `url("${bookingCover}")` }}
        >
          <span className="eyebrow">
            {basket ? "Your booking basket" : "Booking summary"}
          </span>
        </div>
        <div className="summary-body">
          <h2>{SERVICE_NAME}</h2>
          <p className="subline">
            {draft.players} {draft.players === 1 ? "player" : "players"} ·
            Instructor included
          </p>
          {draft.slots.length ? (
            <>
              {basket && (
                <div className="basket-heading">
                  <strong>
                    {draft.slots.length}{" "}
                    {draft.slots.length === 1 ? "session" : "sessions"}
                  </strong>
                  <button
                    className="text-link"
                    onClick={() => update({ slots: [] })}
                  >
                    Clear all
                  </button>
                </div>
              )}
              <SessionList
                slots={draft.slots}
                now={now}
                remove={
                  basket
                    ? (slot) =>
                        update({
                          slots: draft.slots.filter(
                            (item) => slotKey(item) !== slotKey(slot),
                          ),
                        })
                    : undefined
                }
              />
            </>
          ) : (
            <div className="basket-empty">
              <Icon name="calendar" />
              <strong>No sessions selected</strong>
              <p>Choose a date, then add the times that suit you.</p>
            </div>
          )}
          <div className="summary-total">
            <span>Total</span>
            <strong>{money(totalCents(draft))}</strong>
          </div>
          <p className="hint">SGD · Inclusive of GST</p>
          {basket &&
            (draft.slots.length > 0 && valid ? (
              <Link
                className="button wide basket-continue"
                href="/book/details/"
              >
                Continue <Icon name="arrow" />
              </Link>
            ) : (
              <button className="button wide basket-continue" disabled>
                Continue <Icon name="arrow" />
              </button>
            ))}
          {draft.slots.length > 0 && !valid && (
            <p className="field-error" role="status">
              {selectionErrors(draft.slots, now).length > 0 ||
              result?.status === "success"
                ? "A selected session is no longer available. Remove it and choose another time."
                : !result
                  ? "Checking your selected sessions…"
                  : "Your selections are saved. Availability could not be checked."}
            </p>
          )}
          {basket && (
            <p className="hint">
              Your selections are not reserved until booking is confirmed.
            </p>
          )}
        </div>
      </aside>
      {instructors.length > 0 && (
        <section
          className="booking-instructors"
          aria-labelledby="instructors-heading"
        >
          <h2 className="sr-only" id="instructors-heading">
            Your instructors
          </h2>
          {instructors.map((id) => (
            <InstructorProfile key={id} id={id} />
          ))}
        </section>
      )}
    </div>
  );
}
