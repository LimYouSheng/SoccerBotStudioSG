"use client";
import { BookingLoading as BrandLoading } from "./booking-loading";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";

import {
  isElapsed,
  slotKey,
  sessionInstructorName,
  sessionPrice,
} from "@/domain/booking";
import {
  addDays,
  dateLabel,
  endTime,
  monthAt,
  money,
  todaySG,
} from "@/domain/dates";
import type { AvailableSlot } from "@/services/contracts";
import { useBooking } from "./provider";
export function TimeStep() {
  const { selectionNotice } = useBooking();
  const {
    draft,
    update,
    now,
    availability,
    showDate,
    calendar,
    showMonth,
    bookingService,
  } = useBooking();
  const today = todaySG(new Date(now));
  const live = bookingService.mode === "live";
  const publicCalendarReady =
    live &&
    bookingService.operations.availability === "live" &&
    !!bookingService.publicCalendar;
  const [date, setDate] = useState(
      () =>
        draft.slots[0]?.date ||
        (live
          ? calendar
              .entry(today.slice(0, 7), now)
              ?.dates.find((day) => day.available)?.date
          : undefined) ||
        today,
    ),
    [selectedMonth, setMonth] = useState(() =>
      monthAt(draft.slots[0]?.date || today, 0),
    );
  const offset = Math.max(
    0,
    Math.min(
      11,
      (+selectedMonth.slice(0, 4) - +today.slice(0, 4)) * 12 +
        +selectedMonth.slice(5, 7) -
        +today.slice(5, 7),
    ),
  );
  const month = monthAt(today, offset),
    firstDay = (new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = new Date(`${monthAt(today, offset + 1)}T12:00:00Z`);
  days.setUTCDate(0);
  const monthResult = calendar.entry(month.slice(0, 7), now);
  const dayAvailability = new Map(
    monthResult?.dates.map((day) => [day.date, day.available]),
  );
  const displayDate =
    publicCalendarReady && dayAvailability.get(date) !== true ? null : date;
  useEffect(() => {
    showMonth(month.slice(0, 7));
    showDate(displayDate);
    return () => showDate(null);
  }, [displayDate, showDate, month, showMonth]);
  const nextAvailable = monthResult?.dates.find(
    (day) => day.date > date && day.available,
  )?.date;
  const { retry } = availability;
  const calendarFailed =
    publicCalendarReady && calendar.failed.includes(month.slice(0, 7));
  const displayUnavailable =
    publicCalendarReady && !!monthResult && dayAvailability.get(date) !== true;
  const result = useMemo(
    () =>
      availability.result?.dates.includes(date)
        ? availability.result
        : displayUnavailable
          ? { status: "success" as const, slots: [], dates: [date] }
          : null,
    [availability.result, date, displayUnavailable],
  );
  const { reconcile } = calendar;
  useEffect(() => {
    if (!live || !result) return;
    reconcile(
      date,
      result.status === "success"
        ? result.slots.some(
            (slot) =>
              slot.date === date && slot.available && !isElapsed(slot, now),
          )
        : undefined,
    );
  }, [live, result, date, now, reconcile]);
  const slots =
    result?.status === "success"
      ? result.slots.filter((slot) => slot.date === date)
      : [];
  function select({
    date,
    start,
    instructor,
    rotationAt,
    native,
  }: AvailableSlot) {
    const slot = {
        date,
        start,
        instructor,
        rotationAt,
        ...(native ? { native } : {}),
      },
      selected = draft.slots.some((item) => slotKey(item) === slotKey(slot));
    if (
      !selected &&
      (isElapsed(slot) ||
        !slots.some(
          (candidate) =>
            slotKey(candidate) === slotKey(slot) && candidate.available,
        ))
    )
      return;
    update({
      slots: selected
        ? draft.slots.filter((item) => slotKey(item) !== slotKey(slot))
        : [...draft.slots, slot],
    });
  }
  return (
    <>
      <h1 className="page-title">Select dates and times</h1>
      {selectionNotice && (
        <p className="alert" role="alert">
          {selectionNotice}
        </p>
      )}
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
              onChange={(e) => setMonth(monthAt(today, +e.target.value))}
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
              onClick={() => setMonth(monthAt(today, offset - 1))}
            >
              <Icon name="back" />
            </button>
            <button
              className="icon-button"
              aria-label="Next month"
              disabled={offset === 11}
              onClick={() => setMonth(monthAt(today, offset + 1))}
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
                disabled={
                  value < today || (live && dayAvailability.get(value) !== true)
                }
                title={
                  live
                    ? dayAvailability.get(value) === true
                      ? "Available sessions"
                      : dayAvailability.get(value) === false
                        ? "No available sessions"
                        : "Availability not verified"
                    : undefined
                }
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
        {live && (
          <p role="status" className="hint">
            {monthResult ? (
              "Only dates with available sessions can be selected."
            ) : calendar.failed.includes(month.slice(0, 7)) ? (
              "Availability could not be checked. Your selections are saved."
            ) : (
              <BrandLoading compact label="Checking available dates…" />
            )}{" "}
            <button className="text-link" onClick={calendar.retry}>
              Refresh availability
            </button>
          </p>
        )}
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
      {!result ? (
        calendarFailed ? (
          <p>
            Refresh availability to choose a session. Your selections are saved.
          </p>
        ) : (
          <BrandLoading compact label="Checking available times…" />
        )
      ) : result.status !== "success" ? (
        <div className="alert" role="alert">
          <p>{result.message}</p>
          {result.status !== "unavailable" && (
            <button className="text-link" onClick={retry}>
              Try again
            </button>
          )}
        </div>
      ) : slots.length ? (
        <div className="times" role="group" aria-label="Session times">
          {slots.map((slot) => {
            const selected = draft.slots.some(
              (item) => slotKey(item) === slotKey(slot),
            );
            const elapsed = isElapsed(slot, now);
            return (
              <button
                key={slot.start}
                className={`time${selected ? " selected" : ""}`}
                aria-pressed={selected}
                disabled={(!slot.available || elapsed) && !selected}
                onClick={() => select(slot)}
              >
                <span className="time-details">
                  <span>
                    {slot.start}–{endTime(slot.start)}
                  </span>
                  <span className="time-rate">
                    {elapsed ? (
                      "Session has started"
                    ) : slot.available ? (
                      <>
                        <strong>{money(sessionPrice(slot))}</strong>
                        <span>
                          {slot.native ? "Per session" : "Trial price"}
                        </span>
                      </>
                    ) : (
                      "Unavailable"
                    )}
                  </span>
                  <span className="time-instructor">
                    {slot.available || elapsed
                      ? sessionInstructorName(slot)
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
            disabled={live && !nextAvailable}
            onClick={() => {
              const next = live ? nextAvailable : addDays(date, 1);
              if (!next) return;
              setDate(next);
              setMonth(monthAt(next, 0));
            }}
          >
            {live ? "See next available day" : "See next day"}{" "}
            <Icon name="arrow" />
          </button>
        </div>
      )}
      <p className="note">
        <Icon name="clock" />
        <span>
          {live
            ? "Open noon–8pm. Book at least 4 hours ahead. Each session includes one instructor. Your selection is checked when you review your booking."
            : "Open noon–8pm. Each session includes one instructor. In this preview, instructors rotate every three hours; the instructor assigned at the start stays for your full session."}
        </span>
      </p>
    </>
  );
}
