"use client";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { INSTRUCTORS, PRICE_CENTS, SERVICE_NAME } from "@/domain/catalog";
import {
  orderedSlots,
  slotKey,
  totalCents,
  type BookingDraft,
  type Slot,
} from "@/domain/booking";
import { dateLabel, endTime, money } from "@/domain/dates";
import { services } from "@/services";
import { useBooking } from "./provider";
export function SessionList({
  slots,
  remove,
}: {
  slots: (Slot & { studio?: string })[];
  remove?: (slot: Slot) => void;
}) {
  return (
    <ol
      className="max-h-80 divide-y divide-line overflow-y-auto"
      aria-label="Selected sessions"
    >
      {orderedSlots(slots).map((slot) => {
        const studio = slots.find(
          (item) => slotKey(item) === slotKey(slot),
        )?.studio;
        return (
          <li
            key={slotKey(slot)}
            className="flex items-center justify-between gap-3 py-4"
          >
            <div>
              <strong className="block text-sm">{dateLabel(slot.date)}</strong>
              <span className="mt-1 block text-sm text-muted">
                {slot.start}–{endTime(slot.start)} SGT
              </span>
              {studio && <span className="mt-1 block text-sm">{studio}</span>}
            </div>
            {remove && (
              <button
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line"
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
}
export function PriceSummary({ draft }: { draft: BookingDraft }) {
  return (
    <>
      <div className="flex justify-between gap-3 py-4 text-sm">
        <span>{draft.slots.length} × 40 min session</span>
        <span>{money(PRICE_CENTS)} each</span>
      </div>
      <div className="flex justify-between border-t border-line py-4 text-lg">
        <span>Total</span>
        <strong>{money(totalCents(draft))}</strong>
      </div>
      <p className="text-xs text-muted">SGD · Inclusive of GST</p>
    </>
  );
}
export function Summary({ basket = false }: { basket?: boolean }) {
  const { draft, update } = useBooking();
  const valid = draft.slots.every((slot) =>
    services.booking
      .availability(slot.date)
      .some(
        (available) =>
          slotKey(available) === slotKey(slot) && available.available,
      ),
  );
  return (
    <aside
      className="surface h-fit lg:sticky lg:top-6"
      aria-label="Your booking summary"
    >
      <span className="eyebrow text-muted">
        {basket ? "Your booking basket" : "Booking summary"}
      </span>
      <h2 className="mt-3 text-xl">{SERVICE_NAME}</h2>
      <p className="mt-2 text-sm text-muted">
        {draft.players} {draft.players === 1 ? "player" : "players"} ·
        Instructor included
      </p>
      {draft.slots.length ? (
        <SessionList
          slots={draft.slots}
          remove={
            basket
              ? (slot) =>
                  update({
                    slots: draft.slots.filter(
                      (item) => slotKey(item) !== slotKey(slot),
                    ),
                    instructor: null,
                  })
              : undefined
          }
        />
      ) : (
        <p className="my-8 text-sm text-muted">No sessions selected</p>
      )}
      <PriceSummary draft={draft} />
      {draft.instructor && (
        <div className="mt-5 border-t border-line pt-4 text-sm">
          <strong>{INSTRUCTORS[draft.instructor].name}</strong>
          <p className="text-muted">{INSTRUCTORS[draft.instructor].role}</p>
        </div>
      )}
      {basket &&
        (draft.slots.length && draft.instructor && valid ? (
          <Link className="button mt-6 w-full" href="/book/details/">
            Continue <Icon name="arrow" />
          </Link>
        ) : (
          <button className="button mt-6 w-full" disabled>
            Continue <Icon name="arrow" />
          </button>
        ))}
    </aside>
  );
}
