"use client";
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
import { services } from "@/services";
import { defineBookingService } from "@/services/booking";
import {
  BookingServiceError,
  type BookingService,
  type BookingOperation,
} from "@/services/contracts";
import {
  loadBooking,
  saveBooking,
  type StoredBooking,
} from "@/services/storage";
import { useBookingAvailability } from "./availability";
type Action = Exclude<BookingOperation, "availability">;
type ActionState = {
  status:
    "idle" | "loading" | "success" | "failure" | "unavailable" | "cancelled";
  operation?: Action;
  error?: string;
};
interface BookingContextValue extends StoredBooking {
  availability: ReturnType<typeof useBookingAvailability>;
  showDate: (date: string | null) => void;
  ready: boolean;
  now: number;
  revision: number;
  bookingService: BookingService;
  action: ActionState;
  cancel: () => void;
  update: (change: Partial<BookingDraft>) => void;
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
}: {
  children: ReactNode;
  bookingService?: BookingService;
}) {
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
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const active = useRef<{
    controller: AbortController;
    operation: Action;
  } | null>(null);
  const mounted = useRef(false);
  const [date, showDate] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sessionKey = useCallback(
    () =>
      value.draft.mode === "member"
        ? JSON.stringify(services.identity.read())
        : "guest",
    [value.draft.mode],
  );
  const availability = useBookingAvailability(
    service,
    [
      ...(date ? [date] : []),
      ...(value.ready ? value.draft.slots.map((slot) => slot.date) : []),
    ],
    value.draft.players,
    JSON.stringify([
      value.draft.mode,
      value.draft.accountEmail,
      value.attempt?.id,
      value.attempt?.status,
    ]),
    Math.floor(now / 60_000),
    sessionKey,
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
  }, []);
  useEffect(() => {
    mounted.current = true;
    commit(
      service.mode === "demo"
        ? loadBooking()
        : { version: 2, draft: blankDraft(), attempt: null },
    );
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [commit, cancel, service]);
  const run = useCallback(
    async (operation: Action, outcome: Outcome = "success") => {
      if (active.current || !mounted.current || !latest.current.ready)
        return false;
      const current = latest.current;
      if (operation !== "checkout" && !current.attempt) return false;
      const request = { controller: new AbortController(), operation };
      active.current = request; // Synchronous guard also catches same-turn double clicks.
      setAction({ status: "loading", operation });
      const identity = () =>
        current.draft.mode === "member" ? services.identity.read() : null;
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
        const attempt =
          operation === "checkout"
            ? await service.checkout({
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
              : await service[operation]({ attempt: current.attempt!, signal });
        if (!isCurrent()) return false;
        if (JSON.stringify(identity()) !== sessionKey)
          throw new BookingServiceError(
            "conflict",
            "Your email session has changed. Verify your email again.",
          );
        if (operation === "checkout" && service.mode === "demo")
          services.identity.saveProfile(current.draft);
        commit({ ...current, attempt });
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
    [service, commit],
  );
  useEffect(() => {
    if (value.attempt?.status !== "checking") return;
    const timer = setTimeout(
      () => {
        void run("resolve");
      },
      Math.max(0, value.attempt.checkUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [value.attempt, run]);
  return (
    <Context.Provider
      value={{
        ...value,
        now,
        bookingService: service,
        action,
        cancel,
        availability,
        showDate,
        update(change) {
          const current = latest.current;
          if (
            paymentLocked(current.attempt) ||
            (active.current && active.current.operation !== "checkout")
          )
            return;
          cancel();
          commit({
            ...current,
            draft: { ...current.draft, accepted: false, ...change },
            attempt: null,
          });
        },
        checkout: () => run("checkout"),
        pay: (outcome) => run("pay", outcome),
        check: () => run("check"),
        resolve: () => run("resolve"),
        reset() {
          const current = latest.current;
          if (
            active.current ||
            (current.attempt &&
              ["checking", "pending", "late"].includes(current.attempt.status))
          )
            return;
          cancel();
          commit({ version: 2, draft: blankDraft(), attempt: null });
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useBooking() {
  const context = useContext(Context);
  if (!context) throw new Error("BookingProvider is required.");
  return context;
}
