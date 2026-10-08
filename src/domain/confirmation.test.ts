import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyConfirmation, type ConfirmationInput } from "./confirmation";

function fixture(): ConfirmationInput {
  const nowMs = 1_800_000_000_000;
  const scope = {
    accountId: "account-test",
    environmentId: "sandbox-test",
    attemptId: "attempt-alpha",
  };
  const subject = { kind: "guest" as const, id: "guest-record-a" };
  const money = { totalMinor: 4575, taxMinor: 275, currency: "USD" };
  const session = {
    bookingId: "booking-alpha",
    serviceId: "lesson-intro",
    instructorId: "coach-a",
    startMs: nowMs + 86_400_000,
    playEndMs: nowMs + 88_800_000,
    occupiedStartMs: nowMs + 86_100_000,
    occupiedEndMs: nowMs + 89_400_000,
  };
  return {
    nowMs,
    policy: { maxObservationAgeMs: 1000, verificationDeadlineMs: nowMs + 5000 },
    attempt: {
      ...scope,
      subject,
      customerId: "customer-a",
      approvedAtMs: nowMs - 10_000,
      invoiceId: "invoice-alpha",
      money: { ...money },
      bookings: [{ session: { ...session }, money: { ...money } }],
    },
    access: {
      ...scope,
      subject: { ...subject },
      permission: "confirmation:read",
      validFromMs: nowMs - 5000,
      expiresAtMs: nowMs + 30_000,
    },
    bookings: [
      {
        ...scope,
        customerId: "customer-a",
        observedAtMs: nowMs - 500,
        invoiceId: "invoice-alpha",
        session: { ...session },
        status: "confirmed",
      },
    ],
    invoice: {
      ...scope,
      customerId: "customer-a",
      observedAtMs: nowMs - 500,
      invoiceId: "invoice-alpha",
      money: { ...money },
      lines: [{ bookingId: session.bookingId, money: { ...money } }],
      status: "paid",
      paymentReceived: true,
    },
  };
}
function withTwoSessions(): ConfirmationInput {
  const input = fixture();
  const second = structuredClone(input.attempt.bookings[0]);
  second.session.bookingId = "booking-beta";
  second.session.instructorId = "coach-b";
  for (const field of [
    "startMs",
    "playEndMs",
    "occupiedStartMs",
    "occupiedEndMs",
  ] as const)
    second.session[field] += 86_400_000;
  input.attempt.bookings.push(second);
  input.bookings.push({ ...input.bookings[0], session: { ...second.session } });
  input.invoice!.lines.push({
    bookingId: second.session.bookingId,
    money: { ...second.money },
  });
  input.attempt.money.totalMinor *= 2;
  input.attempt.money.taxMinor *= 2;
  input.invoice!.money = { ...input.attempt.money };
  return input;
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
const confirmed = { status: "confirmed", reason: "verified" };
const denied = { status: "denied", reason: "access_denied" };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offline confirmation evidence", () => {
  it("confirms a fully matched paid guest booking without returning record data", () => {
    expect(verifyConfirmation(fixture())).toEqual(confirmed);
  });
  it("supports principal access and approved financial values without historical account constants", () => {
    const input = fixture();
    input.attempt.subject = { kind: "principal", id: "member-b" };
    input.access.subject = { ...input.attempt.subject };
    const money = { totalMinor: 123, taxMinor: 0, currency: "EUR" };
    input.attempt.money = { ...money };
    input.attempt.bookings[0].money = { ...money };
    input.invoice!.money = { ...money };
    input.invoice!.lines[0].money = { ...money };
    expect(verifyConfirmation(input)).toEqual(confirmed);
  });
  it("confirms complete multi-session evidence independent of observation order", () => {
    const input = withTwoSessions();
    input.bookings.reverse();
    input.invoice!.lines.reverse();
    expect(verifyConfirmation(input)).toEqual(confirmed);
  });
  it("denies absent or malformed access with one non-disclosing result", () => {
    for (const access of [
      undefined,
      null,
      {},
      true,
      { authorized: true },
      { ...fixture().access, expiresAtMs: "later" },
    ]) {
      expect(verifyConfirmation({ ...fixture(), access })).toEqual(denied);
    }
    for (const value of [undefined, null, [], {}, { nowMs: NaN }])
      expect(verifyConfirmation(value)).toEqual(denied);
  });
  it("does not inspect protected observations when access is denied", () => {
    const input = { ...fixture(), access: null };
    const read = vi.fn(() => {
      throw new Error("protected evidence must not be read");
    });
    Object.defineProperty(input, "invoice", { get: read });
    Object.defineProperty(input, "bookings", { get: read });
    expect(verifyConfirmation(input)).toEqual(denied);
    expect(read).not.toHaveBeenCalled();
  });
  it("denies cross-account environment attempt principal and capability scopes", () => {
    for (const field of ["accountId", "environmentId", "attemptId"] as const) {
      const input = fixture();
      input.access[field] = "unrelated";
      expect(verifyConfirmation(input), field).toEqual(denied);
    }
    for (const subject of [
      { kind: "principal", id: "guest-record-a" },
      { kind: "guest", id: "another-guest" },
    ]) {
      expect(
        verifyConfirmation({
          ...fixture(),
          access: { ...fixture().access, subject },
        }),
      ).toEqual(denied);
    }
    expect(
      verifyConfirmation({
        ...fixture(),
        access: { ...fixture().access, permission: "booking:write" },
      }),
    ).toEqual(denied);
  });
  it("uses explicit inclusive access start and exclusive expiry boundaries", () => {
    const input = fixture();
    input.access.validFromMs = input.nowMs;
    expect(verifyConfirmation(input)).toEqual(confirmed);
    input.access.validFromMs++;
    expect(verifyConfirmation(input)).toEqual(denied);
    input.access.validFromMs = input.nowMs - 1;
    input.access.expiresAtMs = input.nowMs + 1;
    expect(verifyConfirmation(input)).toEqual(confirmed);
    input.access.expiresAtMs = input.nowMs;
    expect(verifyConfirmation(input)).toEqual(denied);
    input.access.expiresAtMs = input.access.validFromMs;
    expect(verifyConfirmation(input)).toEqual(denied);
  });
  it("rejects observation account environment attempt and customer mismatches", () => {
    for (const kind of ["booking", "invoice"])
      for (const field of [
        "accountId",
        "environmentId",
        "attemptId",
        "customerId",
      ] as const) {
        const input = fixture();
        const observation =
          kind === "booking" ? input.bookings[0] : input.invoice!;
        observation[field] = "unrelated";
        expect(verifyConfirmation(input), `${kind}.${field}`).toEqual({
          status: "unresolved",
          reason: "scope_mismatch",
        });
      }
  });
  it("keeps missing invoices or incomplete booking observations pending", () => {
    const input = withTwoSessions();
    input.bookings.pop();
    expect(verifyConfirmation(input)).toEqual({
      status: "pending",
      reason: "missing_evidence",
    });
    const noInvoice = fixture();
    noInvoice.invoice = null;
    expect(verifyConfirmation(noInvoice)).toEqual({
      status: "pending",
      reason: "missing_evidence",
    });
    noInvoice.bookings = [];
    expect(verifyConfirmation(noInvoice)).toEqual({
      status: "pending",
      reason: "missing_evidence",
    });
  });
  it("rejects empty or duplicate expected booking identities", () => {
    const empty = fixture();
    empty.attempt.bookings = [];
    expect(verifyConfirmation(empty)).toEqual({
      status: "unresolved",
      reason: "invalid_input",
    });
    const duplicate = withTwoSessions();
    duplicate.attempt.bookings[1].session.bookingId =
      duplicate.attempt.bookings[0].session.bookingId;
    expect(verifyConfirmation(duplicate)).toEqual({
      status: "unresolved",
      reason: "invalid_attempt",
    });
  });
  it("rejects duplicate and unrelated observed bookings rather than counting rows", () => {
    const duplicate = withTwoSessions();
    duplicate.bookings[1] = structuredClone(duplicate.bookings[0]);
    expect(verifyConfirmation(duplicate)).toEqual({
      status: "unresolved",
      reason: "booking_set_conflict",
    });
    const unrelated = fixture();
    unrelated.bookings[0].session.bookingId = "other-booking";
    expect(verifyConfirmation(unrelated)).toEqual({
      status: "unresolved",
      reason: "booking_set_conflict",
    });
  });
  it("requires exact invoice identity and a complete unique invoice booking set", () => {
    const mutations: Array<(input: ConfirmationInput) => void> = [
      (i) => {
        i.bookings[0].invoiceId = "another-invoice";
      },
      (i) => {
        i.invoice!.invoiceId = "another-invoice";
      },
      (i) => {
        i.invoice!.lines.pop();
      },
      (i) => {
        i.invoice!.lines[1] = structuredClone(i.invoice!.lines[0]);
      },
      (i) => {
        i.invoice!.lines[0].bookingId = "unrelated";
      },
      (i) => {
        i.invoice!.lines.push({
          bookingId: "extra",
          money: { ...i.invoice!.money },
        });
      },
    ];
    for (const mutate of mutations) {
      const input = withTwoSessions();
      mutate(input);
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "invoice_association_conflict",
      });
    }
  });
  it("matches service instructor play duration and the entire occupied interval", () => {
    for (const field of [
      "serviceId",
      "instructorId",
      "startMs",
      "playEndMs",
      "occupiedStartMs",
      "occupiedEndMs",
    ] as const) {
      const input = fixture();
      const session = input.bookings[0].session;
      if (field === "serviceId" || field === "instructorId")
        session[field] = "incorrect";
      else session[field] += 1;
      expect(verifyConfirmation(input), field).toEqual({
        status: "unresolved",
        reason: "session_mismatch",
      });
    }
  });
  it("rejects malformed intervals instead of normalizing incorrect durations", () => {
    const mutations: Array<(input: ConfirmationInput) => void> = [
      (i) => {
        i.bookings[0].session.playEndMs = i.bookings[0].session.startMs;
      },
      (i) => {
        i.bookings[0].session.occupiedStartMs =
          i.bookings[0].session.startMs + 1;
      },
      (i) => {
        i.bookings[0].session.occupiedEndMs =
          i.bookings[0].session.playEndMs - 1;
      },
      (i) => {
        i.attempt.bookings[0].session.startMs = -1;
      },
    ];
    for (const mutate of mutations) {
      const input = fixture();
      mutate(input);
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "invalid_input",
      });
    }
  });
  it("requires exact minor-unit total tax and currency for invoice and every line", () => {
    for (const level of ["invoice", "line"])
      for (const field of ["totalMinor", "taxMinor", "currency"] as const) {
        const input = fixture();
        const money =
          level === "invoice"
            ? input.invoice!.money
            : input.invoice!.lines[0].money;
        if (field === "currency") money[field] = "JPY";
        else money[field]++;
        expect(verifyConfirmation(input), `${level}.${field}`).toEqual({
          status: "unresolved",
          reason: "money_mismatch",
        });
      }
  });
  it("refuses fractional negative unsafe coerced and nonfinite financial inputs", () => {
    for (const value of [
      45.75,
      -1,
      Number.MAX_SAFE_INTEGER + 1,
      "4575",
      NaN,
      Infinity,
      null,
    ]) {
      const input = fixture();
      expect(
        verifyConfirmation({
          ...input,
          invoice: {
            ...input.invoice,
            money: { ...input.invoice!.money, totalMinor: value },
          },
        }),
      ).toEqual({ status: "unresolved", reason: "invalid_input" });
    }
    const input = fixture();
    input.invoice!.money.taxMinor = input.invoice!.money.totalMinor + 1;
    expect(verifyConfirmation(input)).toEqual({
      status: "unresolved",
      reason: "invalid_input",
    });
  });
  it("checks approved line totals and currency with overflow-safe integer arithmetic", () => {
    for (const field of ["totalMinor", "taxMinor", "currency"] as const) {
      const input = fixture();
      if (field === "currency") input.attempt.bookings[0].money[field] = "EUR";
      else input.attempt.bookings[0].money[field]++;
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "invalid_attempt",
      });
    }
    const input = withTwoSessions();
    input.attempt.money.totalMinor = Number.MAX_SAFE_INTEGER;
    for (const booking of input.attempt.bookings)
      booking.money.totalMinor = Number.MAX_SAFE_INTEGER;
    expect(verifyConfirmation(input)).toEqual({
      status: "unresolved",
      reason: "invalid_attempt",
    });
  });
  it("never treats a confirmed unpaid booking or pending booking as confirmed payment", () => {
    for (const status of ["unpaid", "pending"] as const) {
      const input = fixture();
      input.invoice!.status = status;
      input.invoice!.paymentReceived = false;
      expect(verifyConfirmation(input)).toEqual({
        status: "pending",
        reason: "payment_pending",
      });
    }
    const input = fixture();
    input.bookings[0].status = "pending";
    expect(verifyConfirmation(input)).toEqual({
      status: "pending",
      reason: "booking_pending",
    });
  });
  it("keeps paid cancelled or invalid bookings unresolved for reconciliation", () => {
    for (const status of ["cancelled", "invalid"] as const) {
      const input = fixture();
      input.bookings[0].status = status;
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "paid_booking_invalid",
      });
      input.invoice!.status = "unpaid";
      input.invoice!.paymentReceived = false;
      expect(verifyConfirmation(input)).toEqual({
        status: "invalid",
        reason: "booking_invalid",
      });
    }
  });
  it("reports known invalid invoice states only from explicit observations", () => {
    for (const status of ["failed", "expired", "cancelled"] as const) {
      const input = fixture();
      input.invoice!.status = status;
      input.invoice!.paymentReceived = false;
      expect(verifyConfirmation(input)).toEqual({
        status: "invalid",
        reason: `invoice_${status}`,
      });
    }
  });
  it("leaves unknown booking payment and invoice states unresolved", () => {
    const mutations: Array<(input: ConfirmationInput) => void> = [
      (i) => {
        i.bookings[0].status = "unknown";
      },
      (i) => {
        i.invoice!.status = "unknown";
      },
      (i) => {
        i.invoice!.paymentReceived = null;
      },
    ];
    for (const mutate of mutations) {
      const input = fixture();
      mutate(input);
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "unknown_state",
      });
    }
  });
  it("refuses missing malformed and unsupported normalized evidence", () => {
    const input = fixture();
    for (const invoice of [
      undefined,
      {},
      { ...input.invoice, status: "success" },
      { ...input.invoice, status: undefined },
      { ...input.invoice, paymentReceived: "true" },
    ]) {
      expect(verifyConfirmation({ ...input, invoice })).toEqual({
        status: "unresolved",
        reason: "invalid_input",
      });
    }
    expect(
      verifyConfirmation({
        ...input,
        bookings: [{ ...input.bookings[0], status: "approved" }],
      }),
    ).toEqual({ status: "unresolved", reason: "invalid_input" });
    expect(verifyConfirmation({ ...input, policy: {} })).toEqual({
      status: "unresolved",
      reason: "invalid_input",
    });
  });
  it("classifies contradictory paid status and payment flags as unresolved", () => {
    for (const status of [
      "paid",
      "unpaid",
      "pending",
      "failed",
      "expired",
      "cancelled",
    ] as const) {
      const input = fixture();
      input.invoice!.status = status;
      input.invoice!.paymentReceived = status !== "paid";
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "payment_conflict",
      });
    }
  });
  it("does not accept browser return or simulated success hints as evidence", () => {
    const input = fixture();
    input.invoice = null;
    input.bookings = [];
    for (const hint of [
      { returnUrl: "/confirmation?success=true" },
      { outcome: "success" },
      { paid: true },
      { status: "confirmed" },
    ]) {
      expect(verifyConfirmation({ ...input, ...hint })).toEqual({
        status: "unresolved",
        reason: "invalid_input",
      });
    }
    expect(verifyConfirmation(input)).toEqual({
      status: "pending",
      reason: "missing_evidence",
    });
  });
  it("ends the local checking window without inventing provider cancellation or payment failure", () => {
    const input = fixture();
    input.invoice!.status = "pending";
    input.invoice!.paymentReceived = false;
    input.policy.verificationDeadlineMs = input.nowMs + 1;
    expect(verifyConfirmation(input)).toEqual({
      status: "pending",
      reason: "payment_pending",
    });
    input.policy.verificationDeadlineMs = input.nowMs;
    expect(verifyConfirmation(input)).toEqual({
      status: "unresolved",
      reason: "verification_window_elapsed",
    });
    input.invoice = null;
    expect(verifyConfirmation(input)).toEqual({
      status: "unresolved",
      reason: "verification_window_elapsed",
    });
  });
  it("permits valid historical paid sessions and verified results after a local checking deadline", () => {
    const input = fixture();
    for (const value of [
      input.attempt.bookings[0].session,
      input.bookings[0].session,
    ]) {
      for (const field of [
        "startMs",
        "playEndMs",
        "occupiedStartMs",
        "occupiedEndMs",
      ] as const)
        value[field] -= 172_800_000;
    }
    input.policy.verificationDeadlineMs = input.nowMs - 1;
    expect(verifyConfirmation(input)).toEqual(confirmed);
  });
  it("enforces caller-supplied freshness at the exact boundary for each observation", () => {
    for (const kind of ["booking", "invoice"]) {
      const input = fixture();
      const observation =
        kind === "booking" ? input.bookings[0] : input.invoice!;
      observation.observedAtMs = input.nowMs - input.policy.maxObservationAgeMs;
      expect(verifyConfirmation(input)).toEqual(confirmed);
      observation.observedAtMs--;
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "stale_observation",
      });
      observation.observedAtMs = input.nowMs + 1;
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "observation_time_invalid",
      });
      observation.observedAtMs = input.attempt.approvedAtMs - 1;
      expect(verifyConfirmation(input)).toEqual({
        status: "unresolved",
        reason: "observation_time_invalid",
      });
    }
    const zero = fixture();
    zero.policy.maxObservationAgeMs = 0;
    zero.bookings[0].observedAtMs = zero.nowMs;
    zero.invoice!.observedAtMs = zero.nowMs;
    expect(verifyConfirmation(zero)).toEqual(confirmed);
    zero.nowMs++;
    expect(verifyConfirmation(zero)).toEqual({
      status: "unresolved",
      reason: "stale_observation",
    });
  });
  it("rejects future approved intent and invalid policy or evaluation times", () => {
    const input = fixture();
    input.attempt.approvedAtMs = input.nowMs + 1;
    expect(verifyConfirmation(input)).toEqual({
      status: "unresolved",
      reason: "invalid_attempt",
    });
    const invalid = fixture();
    invalid.policy.verificationDeadlineMs = invalid.attempt.approvedAtMs - 1;
    expect(verifyConfirmation(invalid)).toEqual({
      status: "unresolved",
      reason: "invalid_attempt",
    });
    expect(verifyConfirmation({ ...fixture(), nowMs: Infinity })).toEqual(
      denied,
    );
    expect(
      verifyConfirmation({
        ...fixture(),
        policy: { ...fixture().policy, maxObservationAgeMs: -1 },
      }),
    ).toEqual({ status: "unresolved", reason: "invalid_input" });
  });
  it("is repeatable with frozen inputs and performs no clock network storage or timer effects", () => {
    const input = withTwoSessions();
    const before = structuredClone(input);
    freeze(input);
    const sideEffect = vi.fn(() => {
      throw new Error("side effect");
    });
    vi.spyOn(Date, "now").mockImplementation(sideEffect);
    for (const name of ["fetch", "setTimeout", "setInterval"])
      vi.stubGlobal(name, sideEffect);
    for (const name of ["localStorage", "sessionStorage"])
      vi.stubGlobal(name, {
        getItem: sideEffect,
        setItem: sideEffect,
        removeItem: sideEffect,
      });
    const first = verifyConfirmation(input);
    const second = verifyConfirmation(input);
    const calls = sideEffect.mock.calls.length;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    expect(first).toEqual(confirmed);
    expect(second).toEqual(first);
    expect(input).toEqual(before);
    expect(calls).toBe(0);
  });
});
