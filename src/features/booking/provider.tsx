"use client";
import { protectedCheckoutService } from "@/services/confirmation";
import { isHitpayCheckoutUrl } from "@/domain/native-checkout";
import { todaySG } from "@/domain/dates";
import { slotKey, sessionPrice } from "@/domain/booking";
import { useCalendarAvailability } from "./calendar-availability";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  blankDraft,
  paymentLocked,
  type BookingDraft,
  type Outcome,
} from "@/domain/booking";
import type { CustomerIdentityService } from "@/services/contracts";
import { services } from "@/services";
import { customerCatalogueService } from "@/services/customer-catalogue";
import { defineBookingService } from "@/services/booking";
import {
  BookingServiceError,
  type BookingService,
  type BookingOperation,
  type AvailableSlot,
} from "@/services/contracts";
import {
  loadBooking,
  saveBooking,
  type StoredBooking,
} from "@/services/storage";
import { useBookingAvailability } from "./availability";
import { NativeSessionInit } from "./native-session-init";
type Action = Exclude<BookingOperation, "availability"> | "reserve";
type ActionState = {
  status:
    "idle" | "loading" | "success" | "failure" | "unavailable" | "cancelled";
  operation?: Action;
  error?: string;
};
interface BookingContextValue extends StoredBooking {
  availability: ReturnType<typeof useBookingAvailability>;
  showDate: (date: string | null) => void;
  calendar: ReturnType<typeof useCalendarAvailability>;
  showMonth: (month: string) => void;
  validateSelection: () => Promise<
    "available" | "unavailable" | "error" | "cancelled"
  >;
  selectionNotice: string | null;
  selectionConfirmed: boolean;
  ready: boolean;
  now: number;
  revision: number;
  bookingService: BookingService;
  identityService: CustomerIdentityService;
  action: ActionState;
  cancel: () => void;
  update: (change: Partial<BookingDraft>) => void;
  reserve: () => Promise<boolean>;
  checkout: () => Promise<boolean>;
  pay: (outcome: Outcome) => Promise<boolean>;
  check: () => Promise<boolean>;
  resolve: () => Promise<boolean>;
  reset: () => void;
}
const Context = createContext<BookingContextValue | null>(null);
export function BookingProvider({
  children,
  bookingService = services.booking,
  identityService = services.customerIdentity,
}: {
  children: ReactNode;
  bookingService?: BookingService;
  identityService?: CustomerIdentityService;
}) {
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const service = useMemo(
    () => defineBookingService(bookingService),
    [bookingService],
  );
  const [value, dispatch] = useReducer(
    (
      _state: StoredBooking & { ready: boolean; revision: number },
      next: StoredBooking & { ready: boolean; revision: number },
    ) => next,
    {
      version: 2,
      draft: blankDraft(),
      attempt: null,
      ready: false,
      revision: 0,
    },
  );
  const [actionState, dispatchAction] = useState<
    ActionState & { owner: BookingService }
  >({ status: "idle", owner: service });
  const setAction = useCallback(
    (next: ActionState) => dispatchAction({ ...next, owner: service }),
    [service],
  );
  const action: ActionState =
    actionState.owner === service ? actionState : { status: "idle" };
  const active = useRef<{
    controller: AbortController;
    operation: Action;
  } | null>(null);
  const continuation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [availabilityRevision, invalidateAvailability] = useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const [calendarMonth, showMonth] = useState(() => todaySG().slice(0, 7));
  const [calendarPaused, pauseCalendar] = useState(false);
  const [date, showDate] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sessionKey = useCallback(
    () =>
      value.draft.mode === "member"
        ? JSON.stringify(identityService.current())
        : "guest",
    [value.draft.mode, identityService],
  );
  const [confirmedSelection, confirmSelection] = useState<{
    owner: BookingService;
    key: string;
  } | null>(null);
  const selectionKey = JSON.stringify([
    service.mode,
    sessionKey(),
    value.draft.nativeServiceId,
    value.draft.players,
    value.draft.slots,
  ]);
  const calendar = useCalendarAvailability(
    service,
    value.ready && value.draft.mode ? value.draft.nativeServiceId : undefined,
    calendarMonth,
    JSON.stringify([
      service.publicCalendar ? "public" : sessionKey(),
      availabilityRevision,
    ]),
    !value.ready || calendarPaused || !!value.attempt,
  );
  useEffect(() => {
    if (
      service.mode !== "live" ||
      service.operations.availability !== "live" ||
      !service.publicCalendar
    )
      return;
    const controller = new AbortController();
    void customerCatalogueService.read(controller.signal).catch(() => {
      // The booking screen owns the recoverable error; no background retry.
    });
    return () => controller.abort();
  }, [service]);
  const availability = useBookingAvailability(
    service,
    value.attempt
      ? []
      : [
          ...(date ? [date] : []),
          ...(value.ready ? value.draft.slots.map((slot) => slot.date) : []),
        ],
    value.draft.players,
    JSON.stringify([
      availabilityRevision,
      value.draft.mode,
      value.draft.accountEmail,
      value.attempt?.id,
      value.attempt?.status,
    ]),
    Math.floor(now / 60_000),
    sessionKey,
    value.draft.nativeServiceId,
    calendar.cachedDates,
  );
  // Every start is minute-aligned. Also refresh after a suspended/background tab
  // resumes; action/service guards still sample the clock at dispatch time.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      timer = setTimeout(refresh, 60_000 - (current % 60_000));
    }
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const latest = useRef(value);
  const commit = useCallback(
    (next: StoredBooking) => {
      const state = {
        ...next,
        ready: true,
        revision: latest.current.revision + 1,
      };
      latest.current = state;
      if (service.mode === "demo") saveBooking(next);
      dispatch(state);
    },
    [service],
  );
  const cancel = useCallback(() => {
    continuation.current?.abort();
    const request = active.current;
    if (!request) return;
    active.current = null;
    request.controller.abort();
    if (mounted.current)
      setAction({
        status: "cancelled",
        operation: request.operation,
        ...(request.operation === "resolve" || request.operation === "check"
          ? {
              error:
                "The status check was interrupted. Check payment status to continue.",
            }
          : {}),
      });
  }, [setAction]);
  useEffect(() => {
    mounted.current = true;
    commit(
      service.mode === "demo"
        ? loadBooking()
        : { version: 2, draft: blankDraft(), attempt: null },
    );
    const controller = new AbortController();
    const revision = latest.current.revision;
    if (
      service.mode === "live" &&
      identityService.mode === "live" &&
      service.restore
    ) {
      void service.restore(controller.signal).then(
        (attempt) => {
          if (
            attempt &&
            !controller.signal.aborted &&
            mounted.current &&
            latest.current.revision === revision &&
            !active.current
          )
            commit({ version: 2, draft: attempt.draft, attempt });
        },
        () => {
          /* A failed protected read cannot restore private state. */
        },
      );
    }
    return () => {
      controller.abort();
      mounted.current = false;
      cancel();
    };
  }, [commit, cancel, service, identityService]);
  const run = useCallback(
    async (operation: Action, outcome: Outcome = "success") => {
      if (active.current || !mounted.current || !latest.current.ready)
        return false;
      let current = latest.current;
      if (
        operation !== "checkout" &&
        operation !== "reserve" &&
        !current.attempt
      )
        return false;
      const request = { controller: new AbortController(), operation };
      active.current = request; // Synchronous guard also catches same-turn double clicks.
      setAction({ status: "loading", operation });
      const identity = () =>
        current.draft.mode === "member" ? identityService.current() : null;
      const session = identity();
      const sessionKey = JSON.stringify(session);
      const isCurrent = () =>
        mounted.current &&
        active.current === request &&
        !request.controller.signal.aborted &&
        latest.current.revision === current.revision;
      try {
        if (
          service.mode === "demo" &&
          current.draft.mode === "member" &&
          session?.email !== current.draft.accountEmail
        )
          throw new BookingServiceError(
            "conflict",
            "Your email session has expired. Verify your email again.",
          );
        const signal = request.controller.signal;
        let attempt =
          operation === "checkout" && current.attempt?.held
            ? current.attempt
            : operation === "checkout" || operation === "reserve"
              ? await service.checkout({
                  holding: operation === "reserve",
                  draft: current.draft,
                  previous: current.attempt,
                  signal,
                })
              : operation === "pay"
                ? await service.pay({
                    attempt: current.attempt!,
                    outcome,
                    signal,
                  })
                : await service[operation]({
                    attempt: current.attempt!,
                    signal,
                  });
        if (!isCurrent()) return false;
        if (JSON.stringify(identity()) !== sessionKey)
          throw new BookingServiceError(
            "conflict",
            "Your email session has changed. Verify your email again.",
          );
        commit({ ...current, attempt });
        current = latest.current;
        if (
          (operation === "checkout" || operation === "reserve") &&
          service.mode === "live"
        ) {
          // Retain the prepared attempt before the one-use provider write.
          // A missing reply must never cause a new preparation or payment.
          attempt = await service.pay({
            attempt,
            outcome: "pending",
            signal,
            holding: operation === "reserve",
          });
          if (!isCurrent()) return false;
          commit({ ...current, attempt });
          current = latest.current;
          if (operation === "reserve") {
            setAction({ status: "success", operation });
            return attempt.held === true && attempt.status === "ready";
          }
          const context = await protectedCheckoutService.context({
            attemptId: attempt.id,
            mode: "live",
            signal,
          });
          if (!isCurrent()) return false;
          if (
            context.checkout.state === "available" &&
            isHitpayCheckoutUrl(context.checkout.url)
          ) {
            setAction({ status: "success", operation });
            location.assign(context.checkout.url);
            // Do not also navigate to the intermediate SoccerBot route.
            return false;
          }
          // Existing native attempts and unknown creation outcomes keep their
          // protected recovery route; never invent or substitute a payment URL.
        }
        setAction({ status: "success", operation });
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        const known =
          error instanceof BookingServiceError
            ? error
            : new BookingServiceError(
                "temporarily_unavailable",
                "We couldn’t complete that request. Please try again.",
              );
        if (known.code === "conflict") invalidateAvailability();
        setAction({
          status:
            known.code === "cancelled"
              ? "cancelled"
              : known.code === "unavailable"
                ? "unavailable"
                : "failure",
          operation,
          error: known.message,
        });
        return false;
      } finally {
        if (active.current === request) active.current = null;
      }
    },
    [service, commit, setAction, identityService],
  );
  useEffect(() => {
    if (service.mode !== "demo" || value.attempt?.status !== "checking") return;
    const timer = setTimeout(
      () => {
        void run("resolve");
      },
      Math.max(0, value.attempt.checkUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [value.attempt, run, service.mode]);
  return (
    <Context.Provider
      value={{
        ...value,
        now,
        bookingService: service,
        identityService,
        action,
        cancel,
        availability,
        showDate,
        calendar,
        selectionNotice,
        selectionConfirmed:
          confirmedSelection?.owner === service &&
          confirmedSelection.key === selectionKey,
        showMonth,
        async validateSelection() {
          if (continuation.current) return "cancelled";
          const current = latest.current;
          const revision = current.revision;
          const identity = sessionKey();
          confirmSelection(null);
          pauseCalendar(true);
          const controller = new AbortController();
          continuation.current = controller;
          let succeeded = false;
          try {
            const dates = [
              ...new Set(current.draft.slots.map((slot) => slot.date)),
            ];
            const offers: AvailableSlot[] = [];
            for (const date of dates)
              offers.push(
                ...(await service.availability({
                  date,
                  players: current.draft.players,
                  serviceId: current.draft.nativeServiceId,
                  fresh: true,
                  signal: controller.signal,
                })),
              );
            succeeded =
              !controller.signal.aborted &&
              mounted.current &&
              sessionKey() === identity &&
              latest.current.revision === revision &&
              dates.length > 0 &&
              current.draft.slots.every((slot) =>
                offers.some(
                  (offer) =>
                    slotKey(offer) === slotKey(slot) &&
                    offer.available &&
                    offer.instructor === slot.instructor &&
                    offer.native?.serviceId === slot.native?.serviceId &&
                    sessionPrice(offer) === sessionPrice(slot),
                ),
              );
            if (
              controller.signal.aborted ||
              !mounted.current ||
              sessionKey() !== identity ||
              latest.current.revision !== revision
            )
              return "cancelled";
            if (succeeded) {
              confirmSelection({ owner: service, key: selectionKey });
              setSelectionNotice(null);
              return "available";
            }
            setSelectionNotice(
              "One or more chosen dates and times are no longer available or have changed. Please choose another time. Your entered details have been kept.",
            );
            return "unavailable";
          } catch {
            if (
              controller.signal.aborted ||
              !mounted.current ||
              latest.current.revision !== revision
            )
              return "cancelled";
            setSelectionNotice(
              "We couldn’t check availability. Your details have been kept. Please try again before continuing.",
            );
            return "error";
          } finally {
            continuation.current = null;
            if (mounted.current && !controller.signal.aborted) {
              if (!succeeded) {
                invalidateAvailability();
                calendar.retry();
                pauseCalendar(false);
              }
            }
          }
        },
        update(change) {
          const current = latest.current;
          if (current.attempt?.held) {
            if (
              active.current ||
              current.attempt.status !== "ready" ||
              Object.keys(change).some((key) => key !== "accepted")
            )
              return;
            const draft = { ...current.draft, ...change };
            commit({
              ...current,
              draft,
              attempt: { ...current.attempt, draft },
            });
            return;
          }
          if (
            paymentLocked(current.attempt) ||
            (active.current && active.current.operation !== "checkout")
          )
            return;
          cancel();
          pauseCalendar(false);
          commit({
            ...current,
            draft: { ...current.draft, accepted: false, ...change },
            attempt: null,
          });
        },
        reserve: () => run("reserve"),
        checkout: () => run("checkout"),
        pay: (outcome) => run("pay", outcome),
        check: () => run("check"),
        resolve: () => run("resolve"),
        reset() {
          const current = latest.current;
          if (
            active.current ||
            (current.attempt &&
              (current.attempt.held ||
                ["checking", "pending", "late"].includes(
                  current.attempt.status,
                )))
          )
            return;
          cancel();
          setSelectionNotice(null);
          commit({ version: 2, draft: blankDraft(), attempt: null });
        },
      }}
    >
      <NativeSessionInit
        enabled={value.ready && service.mode === "live" && !!value.draft.mode}
      />
      {children}
    </Context.Provider>
  );
}

export function useBooking() {
  const context = useContext(Context);
  if (!context) throw new Error("BookingProvider is required.");
  return context;
}
