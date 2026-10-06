"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  blankDraft,
  paymentLocked,
  type Attempt,
  type BookingDraft,
  type Outcome,
} from "@/domain/booking";
import { services } from "@/services";
import {
  loadBooking,
  saveBooking,
  type StoredBooking,
} from "@/services/storage";
interface BookingContextValue extends StoredBooking {
  ready: boolean;
  update: (change: Partial<BookingDraft>) => void;
  checkout: () => void;
  pay: (outcome: Outcome) => void;
  check: () => void;
  reset: () => void;
}
const Context = createContext<BookingContextValue | null>(null);
export function BookingProvider({ children }: { children: ReactNode }) {
  const [value, dispatch] = useReducer(
    (
      _state: StoredBooking & { ready: boolean },
      next: StoredBooking & { ready: boolean },
    ) => next,
    { version: 2, draft: blankDraft(), attempt: null, ready: false },
  );
  const latest = useRef(value);
  const commit = useCallback((next: StoredBooking) => {
    const state = { ...next, ready: true };
    latest.current = state;
    saveBooking(next);
    dispatch(state);
  }, []);
  useEffect(() => {
    commit(loadBooking());
  }, [commit]);
  useEffect(() => {
    if (value.attempt?.status !== "checking") return;
    const timer = setTimeout(
      () => {
        const current = latest.current;
        if (current.attempt?.status !== "checking") return;
        commit({
          ...current,
          attempt: services.booking.resolve(current.attempt),
        });
      },
      Math.max(0, value.attempt.checkUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [value.attempt, commit]);
  const changeAttempt = (operation: (attempt: Attempt) => Attempt) => {
    const current = latest.current;
    if (current.attempt)
      commit({ ...current, attempt: operation(current.attempt) });
  };
  return (
    <Context.Provider
      value={{
        ...value,
        update(change) {
          const current = latest.current;
          if (paymentLocked(current.attempt)) return;
          commit({
            ...current,
            draft: { ...current.draft, accepted: false, ...change },
            attempt: null,
          });
        },
        checkout() {
          const current = latest.current;
          if (
            current.draft.mode === "member" &&
            services.identity.read()?.email !== current.draft.accountEmail
          )
            throw new Error(
              "Your email session has expired. Verify your email again.",
            );
          const attempt = services.booking.checkout(
            current.draft,
            current.attempt,
          );
          services.identity.saveProfile(current.draft);
          commit({ ...current, attempt });
        },
        pay(outcome) {
          changeAttempt((attempt) => services.booking.pay(attempt, outcome));
        },
        check() {
          changeAttempt(services.booking.check);
        },
        reset() {
          const current = latest.current;
          if (
            current.attempt &&
            ["checking", "pending", "late"].includes(current.attempt.status)
          )
            return;
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
