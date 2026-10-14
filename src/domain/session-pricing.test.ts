import { describe, expect, it } from "vitest";
import { sessionRate } from "./session-pricing";
import { blankDraft, totalCents } from "./booking";
import { publicCalendarSchema } from "./native-checkout";

describe("Singapore session pricing", () => {
  it("charges weekdays at 88 and weekends and gazetted substitute holidays at 108", () => {
    for (const date of ["2026-10-14", "2026-11-10", "2027-02-09"])
      expect(sessionRate(date)?.priceMinor).toBe(8800);
    for (const date of [
      "2026-10-17",
      "2026-10-18",
      "2026-11-08",
      "2026-11-09",
      "2026-06-01",
      "2026-08-10",
      "2027-01-01",
      "2027-02-08",
      "2027-10-28",
    ])
      expect(sessionRate(date)?.priceMinor).toBe(10800);
    expect(sessionRate("2026-10-17")?.holiday).toBe(false);
    expect(sessionRate("2026-11-09")?.holiday).toBe(true);
    expect(sessionRate("2028-01-03")).toBeNull();
    expect(sessionRate("2026-02-30")).toBeNull();
  });
  it("totals a mixed demo cart by date and preserves native quote amounts", () => {
    const draft = blankDraft();
    draft.slots = [
      { date: "2026-10-16", start: "09:00", instructor: "faisal" },
      { date: "2026-10-17", start: "09:00", instructor: "faisal" },
    ];
    expect(totalCents(draft)).toBe(19600);
    draft.slots[0].native = {
      serviceId: "2",
      serviceName: "Session",
      instructorName: "Faisal",
      priceMinor: 9000,
      currency: "SGD",
    };
    expect(totalCents(draft)).toBe(19800);
  });
  it("accepts priced public slots and rejects foreign dates, services, duplicate starts and private fields", () => {
    const offer = {
      serviceId: "3",
      productServiceId: "2",
      serviceName: "Session",
      instructorId: "3",
      instructorName: "Nabil",
      startMs: Date.parse("2026-10-17T09:00:00+08:00"),
      priceMinor: 10800,
      currency: "SGD",
    };
    const value = {
      month: "2026-10",
      serviceId: "2",
      observedAtMs: 1,
      dates: [{ date: "2026-10-17", available: true, offers: [offer] }],
    };
    expect(publicCalendarSchema.safeParse(value).success).toBe(true);
    for (const patch of [
      { productServiceId: "4" },
      { startMs: offer.startMs + 86400000 },
      { clientId: "private" },
    ])
      expect(
        publicCalendarSchema.safeParse({
          ...value,
          dates: [{ ...value.dates[0], offers: [{ ...offer, ...patch }] }],
        }).success,
      ).toBe(false);
    expect(
      publicCalendarSchema.safeParse({
        ...value,
        dates: [{ ...value.dates[0], offers: [offer, offer] }],
      }).success,
    ).toBe(false);
    expect(
      publicCalendarSchema.safeParse({
        ...value,
        dates: [{ ...value.dates[0], available: false }],
      }).success,
    ).toBe(false);
  });
});
