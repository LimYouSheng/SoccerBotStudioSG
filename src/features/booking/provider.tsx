"use client";
import { usePathname } from "next/navigation";
import { BookingLoadingProvider } from "./booking-loading";
import {
  protectedCheckoutService,
  expireBooking,
  dismissCompletedBooking,
  completedExitIntent,
  rememberCompletedExit,
  forgetCompletedExit,
} from "@/services/confirmation";
import { isHitpayCheckoutUrl } from "@/domain/native-checkout";
import { todaySG } from "@/domain/dates";
import { slotKey, selectionErrors } from "@/domain/booking";
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
} from "@/services/contracts";
import {
  loadBooking,
  loadLiveDraft,
  saveLiveDraft,
  saveBooking,
  type StoredBooking,
} from "@/services/storage";
import { useBookingAvailability } from "./availability";
type Action = Exclude<BookingOperation, "availability"> | "reserve" | "review";
type ActionState = {
  status:
    "idle" | "loading" | "success" | "failure" | "unavailable" | "cancelled";
  operation?: Action;
  error?: string;
  returnToCalendar?: boolean;
};
interface BookingContextValue extends StoredBooking {
  availability: ReturnType<typeof useBookingAvailability>;
  showDate: (date: string | null) => void;
  calendar: ReturnType<typeof useCalendarAvailability>;
  showMonth: (month: string) => void;
  setCalendarBrowsing: (active: boolean) => void;
  selectionNotice: string | null;
  ready: boolean;
  now: number;
  revision: number;
  confirmationRevision: number;
  bookingService: BookingService;
  identityService: CustomerIdentityService;
  action: ActionState;
  cancel: () => void;
  update: (change: Partial<BookingDraft>) => void;
  reserve: () => Promise<boolean>;
  review: () => Promise<boolean>;
  checkout: () => Promise<boolean>;
  pay: (outcome: Outcome) => Promise<boolean>;
  check: () => Promise<boolean>;
  resolve: () => Promise<boolean>;
  reset: () => void;
  restartAfterExpiry: (attemptId: string) => void;
  restartAfterConfirmation: (attemptId: string) => void;
  rebookingError: string | null;
  retryRebooking: () => void;
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
      _state: StoredBooking & {
        ready: boolean;
        revision: number;
        confirmationRevision: number;
      },
      next: StoredBooking & {
        ready: boolean;
        revision: number;
        confirmationRevision: number;
      },
    ) => next,
    {
      version: 2,
      draft: blankDraft(),
      attempt: null,
      ready: false,
      revision: 0,
      confirmationRevision: 0,
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
  const queueRetry = useRef<{ id: string; revision: number } | null>(null);
  const mounted = useRef(false);
  const exitWork = useRef<{
    id: string;
    promise: Promise<boolean>;
    failed: boolean;
  } | null>(null);
  const [rebookingError, setRebookingError] = useState<string | null>(null);
  const finishExit = useCallback((id: string) => {
    if (exitWork.current?.id === id && !exitWork.current.failed)
      return exitWork.current.promise;
    rememberCompletedExit(id);
    setRebookingError(null);
    const work = { id, failed: false, promise: Promise.resolve(false) };
    exitWork.current = work;
    work.promise = dismissCompletedBooking(id).then(
      () => {
        forgetCompletedExit(id);
        return true;
      },
      () => {
        work.failed = true;
        if (mounted.current && exitWork.current === work)
          setRebookingError(
            "We couldn’t finish closing your previous booking. Your confirmation is saved. Please try again before reviewing a new booking.",
          );
        return false;
      },
    );
    return work.promise;
  }, []);
  const [availabilityRevision, invalidateAvailability] = useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const [restoredOwner, setRestoredOwner] = useState<{
    service: BookingService;
    identityService: CustomerIdentityService;
  } | null>(null);
  const restorationPending =
    service.mode === "live" &&
    identityService.mode === "live" &&
    !!service.restore &&
    (restoredOwner?.service !== service ||
      restoredOwner.identityService !== identityService);
  const [calendarMonth, showMonth] = useState(() => todaySG().slice(0, 7));
  const [calendarPaused, pauseCalendar] = useState(false);
  const [browsingRequested, setCalendarBrowsing] = useState(true);
  const pathname = usePathname();
  // The route is known before the streamed page mounts. A page effect alone
  // can briefly enable display reads while restoring an editable Review.
  const calendarBrowsing =
    browsingRequested &&
    !!pathname &&
    !/\/(?:book\/(?:details|review|payment|confirmation)|confirmation)\/?$/.test(
      pathname,
    );
  const [date, showDate] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sessionKey = useCallback(
    () =>
      value.draft.mode === "member"
        ? JSON.stringify(identityService.current())
        : "guest",
    [value.draft.mode, identityService],
  );
  useEffect(() => {
    if (
      service.mode !== "live" ||
      service.operations.availability !== "live" ||
      !service.publicCalendar ||
      restorationPending ||
      !calendarBrowsing ||
      !!value.attempt
    )
      return;
    const controller = new AbortController();
    void customerCatalogueService.read(controller.signal).catch(() => {
      // The booking screen owns the recoverable error; no background retry.
    });
    return () => controller.abort();
  }, [service, restorationPending, calendarBrowsing, value.attempt]);
  const calendar = useCalendarAvailability(
    service,
    value.ready && value.draft.mode ? value.draft.nativeServiceId : undefined,
    calendarMonth,
    JSON.stringify([
      service.publicCalendar ? "public" : sessionKey(),
      availabilityRevision,
    ]),
    !value.ready ||
      restorationPending ||
      !calendarBrowsing ||
      calendarPaused ||
      !!value.attempt,
  );
  const availability = useBookingAvailability(
    service,
    value.attempt ||
      !calendarBrowsing ||
      calendarPaused ||
      (service.mode === "live" && !date)
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
  const hydrationOwner = useRef({ service, identityService });
  const commit = useCallback(
    (
      next: StoredBooking,
      preserveConfirmation = false,
      preserveOperation = false,
    ) => {
      const state = {
        ...next,
        ready: true,
        revision: latest.current.revision + (preserveOperation ? 0 : 1),
        confirmationRevision:
          latest.current.confirmationRevision + (preserveConfirmation ? 0 : 1),
      };
      latest.current = state;
      if (service.mode === "demo") saveBooking(next);
      else saveLiveDraft(next.draft);
      dispatch(state);
    },
    [service],
  );
  const cancel = useCallback(() => {
    if (mounted.current && !latest.current.attempt) pauseCalendar(false);
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
    const sameSession =
      hydrationOwner.current.service === service &&
      hydrationOwner.current.identityService === identityService;
    hydrationOwner.current = { service, identityService };
    // Hydration and read-only restoration do not change the cookie identity.
    // Actual session/booking actions retain protected-read invalidation.
    commit(
      service.mode === "demo"
        ? loadBooking()
        : { version: 2, draft: loadLiveDraft(), attempt: null },
      sameSession,
    );
    const controller = new AbortController();
    const revision = latest.current.revision;
    const exiting = service.mode === "live" ? completedExitIntent() : null;
    if (exiting) void finishExit(exiting);
    if (
      service.mode === "live" &&
      identityService.mode === "live" &&
      service.restore
    ) {
      void service
        .restore(controller.signal)
        .then(
          (attempt) => {
            if (
              attempt &&
              attempt.id !== exiting &&
              !controller.signal.aborted &&
              mounted.current &&
              latest.current.revision === revision &&
              !active.current
            )
              commit({ version: 2, draft: attempt.draft, attempt }, true);
          },
          () => {
            /* A failed protected read cannot restore private state. */
          },
        )
        .finally(() => {
          if (!controller.signal.aborted)
            setRestoredOwner({ service, identityService });
        });
    }
    return () => {
      controller.abort();
      mounted.current = false;
      cancel();
    };
  }, [commit, cancel, service, identityService, finishExit]);
  useEffect(() => {
    const resume = (event: PageTransitionEvent) => {
      // Browser Back may restore this document with its handoff loader intact.
      // Release that UI operation so the retained attempt routes to recovery;
      // never start another checkout or discard its identity.
      if (event.persisted && active.current?.operation === "checkout") cancel();
    };
    window.addEventListener("pageshow", resume);
    return () => window.removeEventListener("pageshow", resume);
  }, [cancel]);
  const run = useCallback(
    async (operation: Action, outcome: Outcome = "success") => {
      if (active.current || !mounted.current || !latest.current.ready)
        return false;
      let current = latest.current;
      if (
        operation !== "checkout" &&
        operation !== "reserve" &&
        operation !== "review" &&
        !current.attempt
      )
        return false;
      const request = { controller: new AbortController(), operation };
      let checkoutNavigationStarted = false;
      let holdDispatched = false;
      active.current = request; // Synchronous guard also catches same-turn double clicks.
      setAction({ status: "loading", operation });
      if (operation === "reserve" || operation === "checkout")
        pauseCalendar(true);
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
          service.mode === "live" &&
          exitWork.current &&
          (operation === "reserve" || operation === "checkout")
        ) {
          const finished = await finishExit(exitWork.current.id);
          if (!isCurrent()) return false;
          if (!finished)
            throw new BookingServiceError(
              "temporarily_unavailable",
              "Your previous booking could not be closed. Please try again.",
            );
        }
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
        if (operation === "review") {
          // Review is a local draft, not a reservation. The checkout service
          // owns fresh validation at the write boundary.
          const errors = selectionErrors(current.draft.slots, Date.now());
          if (errors.length)
            throw new BookingServiceError("conflict", errors[0]);
          setAction({ status: "success", operation });
          return true;
        }
        const retry = queueRetry.current;
        queueRetry.current = null;
        let attempt =
          operation === "checkout" &&
          current.attempt &&
          (current.attempt.held ||
            (current.attempt.status === "ready" &&
              retry?.id === current.attempt.id &&
              retry.revision === current.revision))
            ? current.attempt
            : operation === "checkout" || operation === "reserve"
              ? await service.checkout({
                  holding:
                    operation === "reserve" ||
                    (operation === "checkout" && service.mode === "live"),
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
          const startCheckout = operation === "checkout" && !attempt.held;
          holdDispatched = operation === "reserve" || startCheckout;
          let handoff: { url: string; expiresAtMs: number } | undefined;
          attempt = await service.pay({
            attempt,
            outcome: "pending",
            signal,
            holding: operation === "reserve" || startCheckout,
            startCheckout,
            onCheckoutReady: (value) => {
              handoff = value;
            },
            onReviewReady:
              operation === "reserve"
                ? () => {
                    if (!isCurrent()) return;
                    attempt = { ...attempt, verifying: true };
                    commit({ ...latest.current, attempt });
                    current = latest.current;
                  }
                : undefined,
          });
          if (!isCurrent()) return false;
          // Consent may change while the created hold is being verified.
          // Carry it forward without canceling or recreating the reservation.
          if (operation === "reserve") {
            current = latest.current;
            attempt = { ...attempt, draft: current.draft };
          }
          commit({ ...current, attempt });
          current = latest.current;
          if (operation === "reserve") {
            setAction({ status: "success", operation });
            return attempt.held === true && attempt.status === "ready";
          }
          if (attempt.status === "pending") {
            setAction({ status: "success", operation });
            return true;
          }
          if (
            handoff &&
            handoff.expiresAtMs > Date.now() &&
            isHitpayCheckoutUrl(handoff.url)
          ) {
            location.assign(handoff.url);
            checkoutNavigationStarted = true;
            return false;
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
            // assign starts navigation asynchronously. Keep the overlay and
            // one-operation guard until this document is replaced.
            location.assign(context.checkout.url);
            checkoutNavigationStarted = true;
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
        if (
          error instanceof BookingServiceError &&
          error.code === "queue_busy"
        ) {
          // Admission failed before this operation started. Keep the same
          // prepared attempt available for an explicit retry.
          if (latest.current.attempt)
            queueRetry.current = {
              id: latest.current.attempt.id,
              revision: latest.current.revision,
            };
          setAction({ status: "failure", operation, error: error.message });
          return false;
        }
        if (
          error instanceof BookingServiceError &&
          error.code === "checkout_window_blocked"
        ) {
          // This rejected preparation has no payment handoff. Keep its identity
          // and show the readback result here instead of polling confirmation.
          setAction({ status: "failure", operation, error: error.message });
          return false;
        }
        // A lost write response is not permission to create another booking.
        // Resolve it once through the protected current-attempt read, accepting
        // only the exact original attempt with a fully verified hold.
        if (
          holdDispatched &&
          service.restore &&
          (!(error instanceof BookingServiceError) ||
            error.code === "invalid_response" ||
            error.code === "temporarily_unavailable")
        ) {
          const originalId = latest.current.attempt?.id;
          const restored = await service
            .restore(request.controller.signal)
            .catch(() => null);
          if (!isCurrent()) return false;
          if (
            restored?.id === originalId &&
            restored?.held &&
            restored.status === "ready"
          ) {
            commit({
              ...latest.current,
              attempt: { ...restored, draft: latest.current.draft },
            });
            setAction({ status: "success", operation });
            return true;
          }
        }
        if (
          error instanceof BookingServiceError &&
          error.code === "checkout_not_started"
        ) {
          commit({ ...latest.current, attempt: null });
          setAction({ status: "failure", operation, error: error.message });
          return false;
        }
        if (holdDispatched && latest.current.attempt) {
          commit({
            ...latest.current,
            attempt: {
              ...latest.current.attempt,
              verifying: undefined,
              status: "checking",
            },
          });
          current = latest.current;
        }
        const known =
          error instanceof BookingServiceError
            ? error
            : new BookingServiceError(
                "temporarily_unavailable",
                "We couldn’t complete that request. Please try again.",
              );
        if (known.code === "reservation_expired" && latest.current.attempt) {
          try {
            await expireBooking(latest.current.attempt.id);
            if (!isCurrent()) return false;
            commit({
              ...latest.current,
              attempt: null,
              draft: { ...latest.current.draft, accepted: false, slots: [] },
            });
            pauseCalendar(false);
            setSelectionNotice(known.message);
            setAction({
              status: "failure",
              operation,
              error: known.message,
              returnToCalendar: true,
            });
          } catch {
            if (isCurrent())
              setAction({
                status: "failure",
                operation,
                error:
                  "Payment status is still being checked. Your original booking has been kept.",
              });
          }
          return false;
        }
        const selectionRejected =
          (operation === "reserve" ||
            operation === "review" ||
            operation === "checkout") &&
          (known.code === "selection_unavailable" ||
            known.code === "selection_changed");
        if (selectionRejected) {
          const rejected =
            current.draft.slots[known.rejectedSessionIndex ?? -1];
          const rejectedSlots = rejected ? [rejected] : current.draft.slots;
          const rejectedKeys = new Set(rejectedSlots.map(slotKey));
          for (const date of new Set(rejectedSlots.map((slot) => slot.date))) {
            const remaining = (calendar.cachedDates[date] ?? []).filter(
              (slot) => !rejectedKeys.has(slotKey(slot)),
            );
            calendar.reconcile(date, remaining.length > 0, remaining);
          }
          commit({
            ...current,
            attempt: null,
            draft: {
              ...current.draft,
              accepted: false,
              slots: current.draft.slots.filter(
                (slot) => !rejectedKeys.has(slotKey(slot)),
              ),
            },
          });
          pauseCalendar(false);
          setSelectionNotice(known.message);
        } else if (known.code === "conflict") invalidateAvailability();
        setAction({
          status:
            known.code === "cancelled"
              ? "cancelled"
              : known.code === "unavailable"
                ? "unavailable"
                : "failure",
          operation,
          error: known.message,
          returnToCalendar: selectionRejected,
        });
        return false;
      } finally {
        if (active.current === request && !checkoutNavigationStarted)
          active.current = null;
        if (mounted.current && !latest.current.attempt) pauseCalendar(false);
      }
    },
    [service, commit, setAction, identityService, calendar, finishExit],
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
        showMonth,
        setCalendarBrowsing,
        rebookingError,
        retryRebooking() {
          if (exitWork.current) void finishExit(exitWork.current.id);
        },
        restartAfterExpiry(id) {
          if (
            active.current ||
            (latest.current.attempt && latest.current.attempt.id !== id)
          )
            return;
          cancel();
          setRestoredOwner({ service, identityService });
          commit({
            ...latest.current,
            attempt: null,
            draft: { ...latest.current.draft, accepted: false, slots: [] },
          });
          pauseCalendar(false);
          setSelectionNotice(
            "Your reservation expired. Please choose a time again. Your contact details have been kept.",
          );
          setAction({ status: "idle", returnToCalendar: true });
        },
        restartAfterConfirmation(id) {
          if (
            active.current ||
            (latest.current.attempt && latest.current.attempt.id !== id)
          )
            throw new Error("booking_exit_changed");
          if (service.mode === "live") void finishExit(id);
          cancel();
          setSelectionNotice(null);
          setRestoredOwner({ service, identityService });
          commit({ version: 2, draft: blankDraft(), attempt: null });
        },
        update(change) {
          const current = latest.current;
          if (current.attempt?.held || current.attempt?.verifying) {
            if (
              (active.current &&
                !(
                  current.attempt.verifying &&
                  active.current.operation === "reserve"
                )) ||
              current.attempt.status !== "ready" ||
              Object.keys(change).some((key) => key !== "accepted")
            )
              return;
            const draft = { ...current.draft, ...change };
            // Only consent may change during this same reservation. It does
            // not invalidate the in-flight hold result or its request guard.
            const consentingDuringReserve =
              current.attempt.verifying === true &&
              active.current?.operation === "reserve";
            commit(
              { ...current, draft, attempt: { ...current.attempt, draft } },
              consentingDuringReserve,
              consentingDuringReserve,
            );
            return;
          }
          if (
            paymentLocked(current.attempt) ||
            (active.current && active.current.operation !== "checkout")
          )
            return;
          cancel();
          if (action.returnToCalendar) setAction({ status: "idle" });
          pauseCalendar(false);
          commit({
            ...current,
            draft: { ...current.draft, accepted: false, ...change },
            attempt: null,
          });
        },
        reserve: () => run("reserve"),
        review: () => run("review"),
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
      <BookingLoadingProvider>{children}</BookingLoadingProvider>
    </Context.Provider>
  );
}

export function useBooking() {
  const context = useContext(Context);
  if (!context) throw new Error("BookingProvider is required.");
  return context;
}
