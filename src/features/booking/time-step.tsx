"use client";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { INSTRUCTORS, PRICE_CENTS } from "@/domain/catalog";
import { slotKey } from "@/domain/booking";
import {
  addDays,
  dateLabel,
  endTime,
  monthAt,
  money,
  todaySG,
} from "@/domain/dates";
import { services } from "@/services";
import { useBooking } from "./provider";
export function TimeStep() {
  const { draft, update } = useBooking();
  const today = todaySG();
  const [date, setDate] = useState(() => draft.slots[0]?.date || today),
    [offset, setOffset] = useState(0),
    [empty, setEmpty] = useState(false);
  const month = monthAt(today, offset),
    firstDay = (new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = new Date(`${monthAt(today, offset + 1)}T12:00:00Z`);
  days.setUTCDate(0);
  const slots = empty ? [] : services.booking.availability(date),
    instructors = services.booking.instructors(draft.slots);
  function select(start: string) {
    const slot = { date, start },
      selected = draft.slots.some((item) => slotKey(item) === slotKey(slot));
    update({
      slots: selected
        ? draft.slots.filter((item) => slotKey(item) !== slotKey(slot))
        : [...draft.slots, slot],
      instructor: null,
    });
  }
  return (
    <>
      <h1 className="page-title">Select dates and times</h1>
      <p className="mt-3 text-muted">
        Add 40-minute sessions on the same or different dates. Start times are
        50 minutes apart, with 10 minutes for exit and entry.
      </p>
      <section className="surface mt-7" aria-label="Booking calendar">
        <div className="mb-5 flex items-center justify-between gap-4">
          <label className="sr-only" htmlFor="calendar-month">
            Calendar month
          </label>
          <select
            id="calendar-month"
            className="min-h-11 max-w-[65%] rounded-lg border border-line bg-white px-3 font-bold"
            value={offset}
            onChange={(e) => setOffset(+e.target.value)}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {dateLabel(monthAt(today, i), {
                  month: "long",
                  year: "numeric",
                })}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <button
              className="back"
              aria-label="Previous month"
              disabled={offset === 0}
              onClick={() => setOffset(offset - 1)}
            >
              <Icon name="back" />
            </button>
            <button
              className="back"
              aria-label="Next month"
              disabled={offset === 11}
              onClick={() => setOffset(offset + 1)}
            >
              <Icon name="arrow" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <span key={day} className="py-2 text-xs text-muted">
              {day}
            </span>
          ))}
          {Array.from({ length: firstDay }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {Array.from({ length: days.getUTCDate() }, (_, i) => {
            const value = addDays(month, i),
              hasSlots = draft.slots.some((slot) => slot.date === value);
            return (
              <button
                key={value}
                className={`relative min-h-11 rounded-lg border text-sm disabled:border-transparent disabled:text-slate-300 ${value === date ? "border-action bg-action font-bold text-white" : "border-transparent hover:bg-slate-100"}`}
                aria-label={dateLabel(value)}
                aria-pressed={date === value}
                disabled={value < today}
                onClick={() => {
                  setDate(value);
                  setEmpty(false);
                }}
              >
                {i + 1}
                {hasSlots && (
                  <span className="absolute bottom-1 left-1/2 h-1 w-1 rounded-full bg-cyan" />
                )}
              </button>
            );
          })}
        </div>
      </section>
      <div className="mt-7 mb-4 flex flex-wrap justify-between gap-3">
        <h2 className="text-xl">{dateLabel(date)}</h2>
        <span className="text-xs text-muted">SGT · Per session</span>
      </div>
      {slots.length ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {slots.map((slot) => {
            const selected = draft.slots.some(
              (item) => slotKey(item) === slotKey(slot),
            );
            return (
              <button
                key={slot.start}
                className={`flex min-h-21 items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm sm:p-4 disabled:border-line disabled:bg-slate-100 disabled:text-slate-400 ${selected ? "border-action bg-action text-white" : "border-line bg-white hover:border-action"}`}
                aria-pressed={selected}
                disabled={!slot.available && !selected}
                onClick={() => select(slot.start)}
              >
                <span>
                  <strong className="block">
                    {slot.start}–{endTime(slot.start)}
                  </strong>
                  <span className="mt-1 block text-xs">
                    {slot.available
                      ? `${money(PRICE_CENTS)} · Trial price`
                      : "Unavailable"}
                  </span>
                </span>
                <Icon name={selected ? "check" : "plus"} className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="surface text-center">
          <Icon name="calendar" className="mx-auto mb-4 h-10 w-10" />
          <h2 className="text-2xl">No times on this day.</h2>
          <p className="mt-3 text-muted">
            Choose another date. Your selections are saved.
          </p>
          <button
            className="button secondary mt-5"
            onClick={() => {
              setDate(addDays(date, 1));
              setEmpty(false);
            }}
          >
            See next available day <Icon name="arrow" />
          </button>
        </div>
      )}
      {draft.slots.length > 0 && (
        <section className="mt-9" aria-label="Available instructors">
          <h2 className="text-2xl">Choose your instructor</h2>
          <p className="mt-3 mb-5 text-sm text-muted">
            Available for all your selected sessions.
          </p>
          <div className="grid gap-3">
            {instructors.map((id) => (
              <label
                key={id}
                className={`flex cursor-pointer items-start gap-4 rounded-xl border p-5 ${draft.instructor === id ? "border-action bg-[#e9eff5]" : "border-line bg-white"}`}
              >
                <input
                  type="radio"
                  name="instructor"
                  className="mt-1"
                  value={id}
                  checked={draft.instructor === id}
                  onChange={() => update({ instructor: id })}
                />
                <span>
                  <strong className="block">{INSTRUCTORS[id].name}</strong>
                  <span className="mt-1 block text-xs font-bold text-muted">
                    {INSTRUCTORS[id].role}
                  </span>
                  <span className="mt-3 block text-sm leading-6 text-muted">
                    {INSTRUCTORS[id].bio}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}
      <details className="mt-8 text-xs text-muted">
        <summary>Preview controls</summary>
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={empty}
            onChange={(e) => setEmpty(e.target.checked)}
          />
          No times on selected day
        </label>
      </details>
    </>
  );
}
