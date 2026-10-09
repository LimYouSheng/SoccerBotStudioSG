import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blankDraft,
  isElapsed,
  draftError,
  guardedStep,
  overlaps,
  selectionErrors,
  slotKey,
  type BookingDraft,
} from "../domain/booking";
import { contactErrors, blankContact } from "../domain/contact";
import { SESSION_STARTS, STUDIOS } from "../domain/demo-catalog";
import { START_INTERVAL_MINUTES } from "../domain/booking-policy";
import { addDays, todaySG, clock } from "../domain/dates";
import { demoBookingModel as service } from "@/services/demo/booking";
import {
  demoIdentityService as identity,
  DEMO_CODE,
} from "@/services/demo/identity";
import { demoSession } from "@/services/demo/schedule";
import { loadBooking, saveBooking, safeWrite } from "@/services/storage";
import { calendarText } from "@/services/exports";
class StorageMock {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) || null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const tomorrow = () => addDays(todaySG(), 1);
function validDraft(): BookingDraft {
  return {
    ...blankDraft(),
    mode: "guest",
    slots: [demoSession({ date: tomorrow(), start: "09:00" })!],
    accepted: true,
    contact: {
      ...blankContact(),
      name: "Demo Customer",
      email: "customer@example.com",
      phone: "+65 8123 4567",
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("sessionStorage", new StorageMock());
  vi.stubGlobal("localStorage", new StorageMock());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("booking contract", () => {
  it("uses one shared studio with 40-minute sessions every 50 minutes", () => {
    expect(STUDIOS).toHaveLength(1);
    expect(START_INTERVAL_MINUTES).toBe(50);
    expect(SESSION_STARTS.slice(0, 3).map(clock)).toEqual([
      "09:00",
      "09:50",
      "10:40",
    ]);
  });
  it("does not admit duplicate, overlapping, stale or off-grid slots", () => {
    const slot = { date: tomorrow(), start: "09:00" };
    expect(selectionErrors([slot, slot])).not.toEqual([]);
    expect(overlaps(slot, { ...slot, start: "09:20" })).toBe(true);
    expect(selectionErrors([{ ...slot, start: "09:40" }])).not.toEqual([]);
    expect(selectionErrors([{ ...slot, date: "2020-01-01" }])).not.toEqual([]);
  });
  it("requires a per-session assignment before details", () => {
    const draft = validDraft();
    draft.slots = [
      { date: tomorrow(), start: "09:00" },
    ] as BookingDraft["slots"];
    expect(guardedStep("details", draft, null)).toBe("time");
    expect(draftError(draft)).toBeTruthy();
  });
  it("rejects missing policy acceptance and invalid player counts", () => {
    const draft = validDraft();
    expect(draftError(draft)).toBeNull();
    expect(draftError({ ...draft, accepted: false })).toBeTruthy();
    expect(draftError({ ...draft, players: 5 })).toBeTruthy();
  });
  it("validates all required contact fields and their length limits", () => {
    const c = validDraft().contact;
    expect(
      contactErrors({
        ...c,
        name: "",
        email: "invalid",
        phone: "123",
        contactMethod: "unknown",
      }),
    ).toMatchObject({
      name: expect.any(String),
      email: expect.any(String),
      phone: expect.any(String),
      contactMethod: expect.any(String),
    });
    expect(
      contactErrors({ ...c, name: "x".repeat(81), academy: "x".repeat(121) }),
    ).toMatchObject({ name: expect.any(String), academy: expect.any(String) });
  });
  it("allows contact-only booking without removed participant fields", () => {
    const c = validDraft().contact;
    expect(Object.keys(blankContact()).sort()).toEqual([
      "academy",
      "contactMethod",
      "email",
      "name",
      "phone",
    ]);
    expect(contactErrors(c)).toEqual({});
    expect(draftError(validDraft())).toBeNull();
  });
  it("rejects verified-email mismatch", () => {
    expect(
      contactErrors(validDraft().contact, "different@example.com"),
    ).toHaveProperty("email");
  });
});
describe("service and payment invariants", () => {
  it("does not reserve a displayed or reviewed slot", () => {
    const draft = validDraft();
    service.checkout(draft, null);
    expect(
      service.availability(tomorrow()).find((slot) => slot.start === "09:00")
        ?.available,
    ).toBe(true);
  });
  it("freezes the reviewed snapshot separately from later draft mutation", () => {
    const draft = validDraft(),
      attempt = service.checkout(draft, null);
    draft.contact.name = "Changed";
    draft.slots.length = 0;
    expect(attempt.draft.contact.name).toBe("Demo Customer");
    expect(attempt.draft.slots).toHaveLength(1);
  });
  it("rechecks final-slot conflicts before offering payment", () => {
    safeWrite("soccerbot-next-demo-inventory", [
      `Studio 1|${tomorrow()}|09:00`,
    ]);
    expect(() => service.checkout(validDraft(), null)).toThrow(
      /no longer available/,
    );
  });
  it("confirms and reserves once even when the old check is repeated", () => {
    const attempt = service.pay(
      service.checkout(validDraft(), null),
      "success",
    );
    const first = service.resolve(attempt, attempt.checkUntil);
    const second = service.resolve(attempt, attempt.checkUntil + 100);
    expect(first.status).toBe("paid");
    expect(second.booking).toEqual(first.booking);
    expect(first.booking?.totalCents).toBe(8800);
    expect(
      service.availability(tomorrow()).find((slot) => slot.start === "09:00")
        ?.available,
    ).toBe(false);
    expect(service.resolve(first)).toEqual(first);
  });
  it("blocks duplicate payment and checkout while pending", () => {
    const checking = service.pay(
        service.checkout(validDraft(), null),
        "pending",
      ),
      pending = service.resolve(checking, checking.checkUntil);
    expect(pending.status).toBe("pending");
    expect(service.pay(pending, "success")).toEqual(pending);
    expect(() => service.checkout(validDraft(), pending)).toThrow(
      /already in progress/,
    );
    expect(guardedStep("review", validDraft(), pending)).toBe("payment");
  });
  it("makes decline retryable and status polling resumable", () => {
    const checking = service.pay(
        service.checkout(validDraft(), null),
        "declined",
      ),
      declined = service.resolve(checking, checking.checkUntil);
    expect(declined.status).toBe("declined");
    const retry = service.pay(declined, "pending"),
      pending = service.resolve(retry, retry.checkUntil),
      checkingAgain = service.check(pending);
    expect(
      service.resolve(checkingAgain, checkingAgain.checkUntil).status,
    ).toBe("paid");
  });
  it("never auto-confirms late payment or allows another pay attempt", () => {
    const checking = service.pay(service.checkout(validDraft(), null), "late"),
      late = service.resolve(checking, checking.checkUntil);
    expect(late.status).toBe("late");
    expect(service.check(late)).toEqual(late);
    expect(service.pay(late, "success")).toEqual(late);
    expect(late.booking).toBeNull();
  });
  it("records multiple dates and generates one calendar event per session in UTC", () => {
    const draft = validDraft();
    draft.slots.push(
      demoSession({ date: addDays(tomorrow(), 1), start: "09:00" })!,
    );
    const attempt = service.pay(service.checkout(draft, null), "success"),
      paid = service.resolve(attempt, attempt.checkUntil),
      ics = calendarText(paid.booking!);
    expect(paid.booking?.totalCents).toBe(17600);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("T010000Z");
    expect(ics).toContain("T014000Z");
    expect(new Set(paid.booking?.slots.map(slotKey)).size).toBe(2);
  });
});
describe("customer verification preview", () => {
  it("rejects wrong, expired and replayed codes", () => {
    const challenge = identity.challenge("demo@example.com");
    expect(() => identity.verify(challenge, "000000", false)).toThrow(
      /incorrect/,
    );
    identity.verify(challenge, DEMO_CODE, false);
    expect(() => identity.verify(challenge, DEMO_CODE, false)).toThrow(
      /expired/,
    );
    const expired = identity.challenge("demo@example.com");
    expired.expiresAt = 0;
    expect(() => identity.verify(expired, DEMO_CODE, false)).toThrow(/expired/);
  });
  it("prefills only approved name and phone after verification", () => {
    const challenge = identity.challenge("customer@example.com");
    identity.verify(challenge, DEMO_CODE, true);
    const draft = validDraft();
    draft.mode = "member";
    draft.accountEmail = "customer@example.com";
    draft.contact.academy = "Private academy";
    identity.saveProfile(draft);
    const profile = identity.profile("customer@example.com");
    expect(profile?.name).toBe("Demo Customer");
    expect(profile?.phone).toBe("+65 8123 4567");
    expect(profile?.academy).toBe("");
    expect(Object.keys(profile!).sort()).toEqual([
      "academy",
      "contactMethod",
      "email",
      "name",
      "phone",
    ]);
    identity.signOut();
    expect(identity.profile("customer@example.com")).toBeNull();
  });
});
describe("opening hours and demo instructor rotation", () => {
  it("offers only complete sessions within 9am to 9pm and rotates instructors every three hours", () => {
    const slots = service.availability(tomorrow());
    expect(slots.map((slot) => slot.start)).toEqual([
      "09:00",
      "09:50",
      "10:40",
      "11:30",
      "12:20",
      "13:10",
      "14:00",
      "14:50",
      "15:40",
      "16:30",
      "17:20",
      "18:10",
      "19:00",
      "19:50",
    ]);
    for (const [start, instructor] of [
      ["09:00", "faisal"],
      ["11:30", "faisal"],
      ["12:20", "daniel"],
      ["14:50", "daniel"],
      ["15:40", "instructor3"],
      ["17:20", "instructor3"],
      ["18:10", "instructor4"],
      ["19:50", "instructor4"],
    ]) {
      expect(demoSession({ date: tomorrow(), start })?.instructor).toBe(
        instructor,
      );
      expect(slots.find((slot) => slot.start === start)?.instructor).toBe(
        instructor,
      );
    }
    expect(demoSession({ date: tomorrow(), start: "08:10" })).toBeNull();
    expect(demoSession({ date: tomorrow(), start: "20:40" })).toBeNull();
    expect(() =>
      service.checkout(
        {
          ...validDraft(),
          slots: [
            { date: tomorrow(), start: "20:40", instructor: "instructor4" },
          ],
        },
        null,
      ),
    ).toThrow();
  });

  it("discloses crossing rotations while retaining the starting instructor for the whole session", () => {
    const slots = service.availability(tomorrow());
    expect(
      slots
        .filter((slot) => slot.rotationAt)
        .map(({ start, rotationAt }) => [start, rotationAt]),
    ).toEqual([
      ["11:30", "12:00"],
      ["14:50", "15:00"],
    ]);
    expect(
      slots.find((slot) => slot.start === "17:20")?.rotationAt,
    ).toBeUndefined();
    const date = Array.from({ length: 7 }, (_, i) =>
      addDays(tomorrow(), i),
    ).find((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === 2)!;
    const draft = {
      ...validDraft(),
      slots: [demoSession({ date, start: "11:30" })!],
    };
    expect(
      service.availability(date).find((slot) => slot.start === "11:30")
        ?.available,
    ).toBe(true);
    const attempt = service.checkout(draft, null);
    const checking = service.pay(attempt, "success");
    const paid = service.resolve(checking, checking.checkUntil);
    expect(paid.booking?.slots[0].instructor).toBe("faisal");
    expect(paid.booking?.slots[0].start).toBe("11:30");
  });
  it("accepts different session instructors and rejects stale assignments or missing rotation disclosures", () => {
    const date = Array.from({ length: 7 }, (_, i) =>
      addDays(tomorrow(), i),
    ).find((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === 2)!;
    const slots = [
      demoSession({ date, start: "11:30" })!,
      demoSession({ date, start: "12:20" })!,
      demoSession({ date: addDays(date, 1), start: "09:00" })!,
    ];
    const attempt = service.pay(
      service.checkout({ ...validDraft(), slots }, null),
      "success",
    );
    const paid = service.resolve(attempt, attempt.checkUntil);
    expect(paid.booking?.slots.map((slot) => slot.instructor)).toEqual([
      "faisal",
      "daniel",
      "faisal",
    ]);
    expect(paid.booking?.totalCents).toBe(26400);
    const ics = calendarText(paid.booking!);
    expect(ics).toContain("Instructor: Faisal Shahril");
    expect(ics).toContain("Instructor: Daniel Tan");
    expect(() =>
      service.checkout(
        { ...validDraft(), slots: [{ ...slots[0], instructor: "daniel" }] },
        null,
      ),
    ).toThrow(/assignment has changed/);
    expect(() =>
      service.checkout(
        { ...validDraft(), slots: [{ ...slots[0], rotationAt: undefined }] },
        null,
      ),
    ).toThrow(/assignment has changed/);
  });
});
it("keeps payment checking for exactly five seconds and preserves the deadline through storage", () => {
  const before = Date.now();
  const attempt = service.pay(service.checkout(validDraft(), null), "success");
  expect(attempt.checkUntil).toBeGreaterThanOrEqual(before + 5000);
  expect(attempt.checkUntil).toBeLessThanOrEqual(Date.now() + 5000);
  expect(service.resolve(attempt, attempt.checkUntil - 1).status).toBe(
    "checking",
  );
  saveBooking({ version: 2, draft: attempt.draft, attempt });
  const restored = loadBooking().attempt!;
  expect(restored.checkUntil).toBe(attempt.checkUntil);
  expect(restored.id).toBe(attempt.id);
  expect(service.resolve(restored, restored.checkUntil).status).toBe("paid");
});
it("upgrades the previous draft without deleting its source or losing contact and session data", () => {
  const draft = validDraft();
  const legacy = {
    version: 1,
    draft: {
      ...draft,
      instructor: null,
      contact: { ...draft.contact, notes: "old optional field" },
      slots: [{ date: tomorrow(), start: "09:00" }],
    },
    attempt: null,
  };
  safeWrite("soccerbot-next-demo-v1", legacy);
  const upgraded = loadBooking();
  expect(upgraded.version).toBe(2);
  expect(upgraded.draft.slots[0].instructor).toBe("faisal");
  expect(upgraded.draft.contact).toEqual(draft.contact);
  expect(upgraded.draft).not.toHaveProperty("instructor");
  saveBooking(upgraded);
  expect(loadBooking()).toEqual(upgraded);
  expect(JSON.parse(sessionStorage.getItem("soccerbot-next-demo-v1")!)).toEqual(
    legacy,
  );
});
it("upgrades pending and paid legacy attempts without changing their identity or charging twice", () => {
  const checking = service.pay(service.checkout(validDraft(), null), "success");
  const legacyDraft = {
    ...checking.draft,
    instructor: "faisal",
    slots: checking.draft.slots.map(({ date, start }) => ({ date, start })),
  };
  safeWrite("soccerbot-next-demo-v1", {
    version: 1,
    draft: legacyDraft,
    attempt: { ...checking, draft: legacyDraft },
  });
  const restored = loadBooking().attempt!;
  expect(restored.id).toBe(checking.id);
  expect(restored.checkUntil).toBe(checking.checkUntil);
  expect(restored.status).toBe("checking");
  const paid = service.resolve(restored, restored.checkUntil);
  const legacyBooking = {
    ...paid.booking!,
    draft: legacyDraft,
    slots: paid.booking!.slots.map(({ date, start, studio }) => ({
      date,
      start,
      studio,
    })),
  };
  safeWrite("soccerbot-next-demo-receipts", { [checking.id]: legacyBooking });
  safeWrite("soccerbot-next-demo-v1", {
    version: 1,
    draft: legacyDraft,
    attempt: { ...paid, draft: legacyDraft, booking: legacyBooking },
  });
  const oldPaid = loadBooking().attempt!;
  expect(oldPaid.status).toBe("paid");
  expect(oldPaid.booking?.slots[0].instructor).toBe("faisal");
  expect(
    service.resolve(restored, restored.checkUntil).booking?.reference,
  ).toBe(checking.id);
  expect(oldPaid.booking?.totalCents).toBe(8800);
});

describe("elapsed demo slots", () => {
  it("marks a slot unavailable exactly at its Singapore start and afterwards", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-10-06T09:00:00+08:00");
    for (const offset of [-1, 0, 1]) {
      vi.setSystemTime(start + offset);
      expect(
        service
          .availability("2026-10-06")
          .find((slot) => slot.start === "09:00")?.available,
      ).toBe(offset < 0);
    }
  });
  it("rejects checkout at or after start without discarding the selected draft", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-10-06T09:00:00+08:00");
    vi.setSystemTime(start - 1);
    const draft = validDraft();
    draft.slots = [demoSession({ date: "2026-10-06", start: "09:00" })!];
    const original = structuredClone(draft);
    expect(service.checkout(draft, null).status).toBe("ready");
    for (const offset of [0, 1]) {
      vi.setSystemTime(start + offset);
      expect(() => service.checkout(draft, null)).toThrow(/started/);
      expect(draft).toEqual(original);
    }
  });
});

it("uses Singapore instants across month and year boundaries regardless of UTC date", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  for (const date of ["2026-11-01", "2027-01-01"]) {
    const midnight = { date, start: "00:00" };
    const boundary = Date.parse(`${date}T00:00:00+08:00`);
    expect(isElapsed(midnight, boundary - 1)).toBe(false);
    expect(isElapsed(midnight, boundary)).toBe(true);
    expect(isElapsed(midnight, boundary + 1)).toBe(true);
    expect(todaySG(new Date(boundary - 1))).toBe(addDays(date, -1));
    vi.setSystemTime(boundary);
    expect(todaySG()).toBe(date);
    expect(
      service.availability(addDays(date, -1)).every((slot) => !slot.available),
    ).toBe(true);
    const draft = validDraft();
    draft.slots = [
      demoSession({ date, start: "09:00" })!,
      demoSession({ date: addDays(date, 1), start: "09:00" })!,
    ];
    expect(selectionErrors(draft.slots)).toEqual([]);
    expect(service.checkout(draft, null).draft.slots).toEqual(draft.slots);
    expect(
      service.availability(date).find((slot) => slot.start === "09:00")
        ?.available,
    ).toBe(true);
  }
});
it("rejects a new payment after start but preserves pending recovery and paid receipts", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.parse("2026-10-06T09:00:00+08:00");
  vi.setSystemTime(start - 1);
  const draft = validDraft();
  draft.slots = [demoSession({ date: "2026-10-06", start: "09:00" })!];
  const ready = service.checkout(draft, null);
  const checking = service.pay(ready, "pending");
  vi.setSystemTime(start + 5000);
  expect(() => service.pay(ready, "success")).toThrow(/started/);
  expect(() =>
    service.pay({ ...ready, status: "declined" }, "success"),
  ).toThrow(/started/);
  const pending = service.resolve(checking);
  expect(pending.status).toBe("pending");
  saveBooking({ version: 2, draft, attempt: pending });
  const restored = loadBooking();
  expect(restored.attempt).toEqual(pending);
  expect(guardedStep("review", restored.draft, restored.attempt)).toBe(
    "payment",
  );
  const resumed = service.check(restored.attempt!);
  expect(resumed.id).toBe(ready.id);
  vi.setSystemTime(resumed.checkUntil);
  const paid = service.resolve(resumed);
  expect(paid.status).toBe("paid");
  expect(service.resolve(resumed)).toEqual(paid);
  vi.setSystemTime(new Date("2027-01-01T00:00:00+08:00"));
  saveBooking({ version: 2, draft, attempt: paid });
  expect(loadBooking().attempt).toEqual(paid);
  expect(guardedStep("time", draft, paid)).toBe("confirmation");
  expect(service.resolve(paid)).toEqual(paid);
  expect(service.pay(paid, "success")).toEqual(paid);
});

it("formats Singapore booking dates independently of locale date order", () => {
  const Original = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
    function (_locales, options) {
      return new Original("en-US", options);
    },
  );
  expect(todaySG(new Date("2026-12-31T15:59:59.999Z"))).toBe("2026-12-31");
  expect(todaySG(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
});
