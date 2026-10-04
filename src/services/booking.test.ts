import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blankDraft,
  draftError,
  guardedStep,
  overlaps,
  selectionErrors,
  slotKey,
  type BookingDraft,
} from "../domain/booking";
import { contactErrors, blankContact } from "../domain/contact";
import {
  SESSION_STARTS,
  STUDIOS,
  START_INTERVAL_MINUTES,
} from "../domain/catalog";
import { addDays, todaySG, clock } from "../domain/dates";
import { demoBookingService as service } from "@/services/demo/booking";
import {
  demoIdentityService as identity,
  DEMO_CODE,
} from "@/services/demo/identity";
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
    instructor: "faisal",
    slots: [{ date: tomorrow(), start: "10:00" }],
    accepted: true,
    contact: {
      ...blankContact(),
      name: "Demo Customer",
      email: "customer@example.com",
      phone: "+65 8123 4567",
      ageGroup: "adult",
      experience: "new",
      emergencyName: "Emergency Person",
      emergencyPhone: "+65 9123 4567",
      emergencyRelationship: "family",
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("sessionStorage", new StorageMock());
  vi.stubGlobal("localStorage", new StorageMock());
});
describe("booking contract", () => {
  it("uses one shared studio with 40-minute sessions every 50 minutes", () => {
    expect(STUDIOS).toHaveLength(1);
    expect(START_INTERVAL_MINUTES).toBe(50);
    expect(SESSION_STARTS.slice(0, 3).map(clock)).toEqual([
      "10:00",
      "10:50",
      "11:40",
    ]);
  });
  it("does not admit duplicate, overlapping, stale or off-grid slots", () => {
    const slot = { date: tomorrow(), start: "10:00" };
    expect(selectionErrors([slot, slot])).not.toEqual([]);
    expect(overlaps(slot, { ...slot, start: "10:20" })).toBe(true);
    expect(selectionErrors([{ ...slot, start: "10:40" }])).not.toEqual([]);
    expect(selectionErrors([{ ...slot, date: "2020-01-01" }])).not.toEqual([]);
  });
  it("requires instructor selection after dates before details", () => {
    const draft = validDraft();
    draft.instructor = null;
    expect(guardedStep("details", draft, null)).toBe("time");
    expect(draftError(draft)).toBeTruthy();
  });
  it("rejects missing policy acceptance and invalid player counts", () => {
    const draft = validDraft();
    expect(draftError(draft)).toBeNull();
    expect(draftError({ ...draft, accepted: false })).toBeTruthy();
    expect(draftError({ ...draft, players: 5 })).toBeTruthy();
  });
  it("requires a guardian for under-18s and a different emergency number for self", () => {
    const c = validDraft().contact;
    expect(contactErrors({ ...c, ageGroup: "child" })).toHaveProperty(
      "emergencyRelationship",
    );
    expect(contactErrors({ ...c, emergencyPhone: c.phone })).toHaveProperty(
      "emergencyPhone",
    );
  });
  it("reuses booking contact for a non-self participant", () => {
    const c = {
      ...validDraft().contact,
      self: false,
      participant: "Young Player",
      relationship: "parent",
      emergencySame: true,
      ageGroup: "child",
      emergencyRelationship: "parent",
      emergencyName: "",
      emergencyPhone: "",
    };
    expect(contactErrors(c)).toEqual({});
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
      service.availability(tomorrow()).find((slot) => slot.start === "10:00")
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
    expect(() => service.checkout(validDraft(), null, true)).toThrow(
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
      service.availability(tomorrow()).find((slot) => slot.start === "10:00")
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
    draft.slots.push({ date: addDays(tomorrow(), 1), start: "10:00" });
    const attempt = service.pay(service.checkout(draft, null), "success"),
      paid = service.resolve(attempt, attempt.checkUntil),
      ics = calendarText(paid.booking!);
    expect(paid.booking?.totalCents).toBe(17600);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("T020000Z");
    expect(ics).toContain("T024000Z");
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
    draft.contact.notes = "Private note";
    identity.saveProfile(draft);
    const profile = identity.profile("customer@example.com");
    expect(profile?.name).toBe("Demo Customer");
    expect(profile?.phone).toBe("+65 8123 4567");
    expect(profile?.notes).toBe("");
    expect(profile?.emergencyName).toBe("");
    identity.signOut();
    expect(identity.profile("customer@example.com")).toBeNull();
  });
});
