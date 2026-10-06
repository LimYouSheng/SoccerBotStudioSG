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
import type { AvailableSlot } from "@/services/contracts";
import { useBooking } from "./provider";
export function TimeStep() {
  const { draft, update } = useBooking();
  const today = todaySG();
  const [date, setDate] = useState(() => draft.slots[0]?.date || today),
    [offset, setOffset] = useState(() => {
      const initial = draft.slots[0]?.date || today;
      return Math.max(
        0,
        Math.min(
          11,
          (+initial.slice(0, 4) - +today.slice(0, 4)) * 12 +
            +initial.slice(5, 7) -
            +today.slice(5, 7),
        ),
      );
    });
  const month = monthAt(today, offset),
    firstDay = (new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = new Date(`${monthAt(today, offset + 1)}T12:00:00Z`);
  days.setUTCDate(0);
  const slots = services.booking.availability(date);
  function select({ date, start, instructor, rotationAt }: AvailableSlot) {
    const slot = { date, start, instructor, rotationAt },
      selected = draft.slots.some((item) => slotKey(item) === slotKey(slot));
    update({
      slots: selected
        ? draft.slots.filter((item) => slotKey(item) !== slotKey(slot))
        : [...draft.slots, slot],
    });
  }
  return (
    <>
      <h1 className="page-title">Select dates and times</h1>
      <p className="lead">
        Add 40-minute sessions on the same or different dates. Start times are
        50 minutes apart, with 10 minutes for exit and entry.
      </p>
      <section className="calendar-panel" aria-label="Booking calendar">
        <div className="calendar-head">
          <div className="month-picker">
            <label className="sr-only" htmlFor="calendar-month">
              Calendar month
            </label>
            <select
              id="calendar-month"
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
          </div>
          <div className="calendar-nav">
            <button
              className="icon-button"
              aria-label="Previous month"
              disabled={offset === 0}
              onClick={() => setOffset(offset - 1)}
            >
              <Icon name="back" />
            </button>
            <button
              className="icon-button"
              aria-label="Next month"
              disabled={offset === 11}
              onClick={() => setOffset(offset + 1)}
            >
              <Icon name="arrow" />
            </button>
          </div>
        </div>
        <div className="calendar-weekdays">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="dates">
          {Array.from({ length: firstDay }, (_, i) => (
            <span className="date-placeholder" key={`blank-${i}`} />
          ))}
          {Array.from({ length: days.getUTCDate() }, (_, i) => {
            const value = addDays(month, i),
              hasSlots = draft.slots.some((slot) => slot.date === value);
            return (
              <button
                key={value}
                className={`date${value === date ? " selected" : ""}${value === today ? " today" : ""}${hasSlots ? " in-series" : ""}`}
                aria-label={dateLabel(value)}
                aria-pressed={date === value}
                disabled={value < today}
                onClick={() => {
                  setDate(value);
                }}
              >
                <strong>{i + 1}</strong>
                <span className="dot" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <div className="calendar-legend">
          <span>
            <i className="legend-mark" />
            Selected day
          </span>
          <span>
            <i className="legend-mark series" />
            In your booking
          </span>
        </div>
      </section>
      <div className="time-heading">
        <h2>{dateLabel(date)}</h2>
        <span>SGT · Per session</span>
      </div>
      {slots.length ? (
        <div className="times" role="group" aria-label="Session times">
          {slots.map((slot) => {
            const selected = draft.slots.some(
              (item) => slotKey(item) === slotKey(slot),
            );
            return (
              <button
                key={slot.start}
                className={`time${selected ? " selected" : ""}`}
                aria-pressed={selected}
                disabled={!slot.available && !selected}
                onClick={() => select(slot)}
              >
                <span className="time-details">
                  <span>
                    {slot.start}–{endTime(slot.start)}
                  </span>
                  <span className="time-rate">
                    {slot.available ? (
                      <>
                        <strong>{money(PRICE_CENTS)}</strong>
                        <span>Trial price</span>
                      </>
                    ) : (
                      "Unavailable"
                    )}
                  </span>
                  <span className="time-instructor">
                    {slot.available
                      ? INSTRUCTORS[slot.instructor].name
                      : "No instructor available"}
                  </span>
                  {slot.available && slot.rotationAt && (
                    <span className="rotation-notice">
                      Crosses the {slot.rotationAt} instructor rotation. Your
                      assigned instructor stays for the full session.
                    </span>
                  )}
                </span>
                <Icon name={selected ? "check" : "plus"} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="calendar" />
          <h3>No times on this day.</h3>
          <p>Choose another date. Your selections are saved.</p>
          <button
            className="button secondary"
            onClick={() => {
              const next = addDays(date, 1);
              setDate(next);
              setOffset(
                Math.max(
                  0,
                  Math.min(
                    11,
                    (+next.slice(0, 4) - +today.slice(0, 4)) * 12 +
                      +next.slice(5, 7) -
                      +today.slice(5, 7),
                  ),
                ),
              );
            }}
          >
            See next available day <Icon name="arrow" />
          </button>
        </div>
      )}
      <p className="note">
        <Icon name="clock" />
        <span>
          Open 9am–9pm. Each session includes one instructor. In this preview,
          instructors rotate every three hours; the instructor assigned at the
          start stays for your full session.
        </span>
      </p>
    </>
  );
}
