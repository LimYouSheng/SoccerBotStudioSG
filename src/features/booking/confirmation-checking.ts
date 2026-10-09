"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmationError, readConfirmation } from "@/services/confirmation";
type View = "checking" | "confirmed" | "unavailable" | "unresolved" | "denied";
type Window = { deadline: number; next: number; count: number };
function windowFor(id: string): Window {
  try {
    const value = JSON.parse(
      localStorage.getItem(`soccerbot-checking:${id}`) || "null",
    ) as Window | null;
    if (
      value &&
      [value.deadline, value.next, value.count].every(Number.isSafeInteger) &&
      value.deadline >= 0 &&
      value.next >= 0 &&
      value.count >= 0
    )
      return value;
  } catch {
    /* Server limits remain authoritative when browser storage fails. */
  }
  return { deadline: Date.now() + 600000, next: 0, count: 0 };
}
function save(id: string, window: Window) {
  try {
    localStorage.setItem(`soccerbot-checking:${id}`, JSON.stringify(window));
  } catch {
    /* No capability or decision is persisted. */
  }
}
export function useConfirmationChecking(
  attemptId: string,
  sessionRevision = 0,
) {
  const [result, setResult] = useState<{
    id: string;
    revision: number;
    view: View;
    busy: boolean;
    next: number;
  } | null>(null);
  const refresh = useRef<() => void>(() => {});
  const check = useCallback(() => refresh.current(), []);
  useEffect(() => {
    let active = true,
      busy = false,
      generation = 0;
    let controller: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let budget = windowFor(attemptId);
    save(attemptId, budget);
    const show = (view: View) => {
      if (active)
        setResult({
          id: attemptId,
          revision: sessionRevision,
          view,
          busy,
          next: budget.next,
        });
    };
    let terminal = false;
    function schedule() {
      clearTimeout(timer);
      if (!active || terminal || document.hidden) return;
      timer = setTimeout(
        () => void poll(),
        Math.max(
          1,
          Math.min(
            5000,
            budget.next - Date.now(),
            budget.deadline - Date.now(),
          ),
        ),
      );
    }
    function reserve() {
      const claim = () => {
        const shared = windowFor(attemptId);
        budget = {
          deadline: Math.min(budget.deadline, shared.deadline),
          next: Math.max(budget.next, shared.next),
          count: Math.max(budget.count, shared.count),
        };
        if (Date.now() >= budget.deadline || budget.count >= 120) {
          terminal = true;
          show("unresolved");
          return false;
        }
        if (Date.now() < budget.next) return false;
        budget = {
          ...budget,
          next: Date.now() + 5000,
          count: budget.count + 1,
        };
        save(attemptId, budget);
        return true;
      };
      return navigator.locks
        ? navigator.locks
            .request(`soccerbot-checking:${attemptId}`, claim)
            .catch(() => claim())
        : claim();
    }
    async function poll() {
      if (!active || terminal || busy || document.hidden) return;
      busy = true;
      const current = ++generation;
      const reservation = reserve();
      if (
        !(typeof reservation === "boolean" ? reservation : await reservation)
      ) {
        busy = false;
        if (active && !terminal) {
          show("checking");
          schedule();
        }
        return;
      }
      if (!active || current !== generation) {
        busy = false;
        return;
      }
      const requestController = new AbortController();
      controller = requestController;
      show("checking");
      let requestTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          readConfirmation(attemptId, requestController.signal),
          new Promise<never>((_, reject) => {
            requestTimer = setTimeout(
              () => {
                requestController.abort();
                reject(new ConfirmationError("unavailable"));
              },
              Math.max(1, Math.min(10000, budget.deadline - Date.now())),
            );
          }),
        ]);
        if (!active || generation !== current) return;
        budget.deadline = Math.min(
          budget.deadline,
          response.checking.deadlineMs ?? budget.deadline,
        );
        budget.next = Math.max(budget.next, response.checking.nextCheckMs ?? 0);
        save(attemptId, budget);
        if (response.status === "confirmed") {
          terminal = true;
          show("confirmed");
        } else if (response.status === "denied") {
          terminal = true;
          show("denied");
        } else if (
          response.status !== "pending" ||
          Date.now() >= budget.deadline
        ) {
          terminal = true;
          show("unresolved");
        } else show("checking");
      } catch (error) {
        if (!active || generation !== current) return;
        if (Date.now() >= budget.deadline) {
          terminal = true;
          show("unresolved");
        } else if (error instanceof ConfirmationError) {
          budget.deadline = Math.min(
            budget.deadline,
            error.deadlineMs ?? budget.deadline,
          );
          budget.next = Math.max(budget.next, error.nextCheckMs ?? 0);
          save(attemptId, budget);
          if (error.kind === "denied") {
            terminal = true;
            show("denied");
          } else if (error.kind === "exhausted") {
            terminal = true;
            show("unresolved");
          } else show(error.kind === "throttled" ? "checking" : "unavailable");
        } else show("unavailable");
      } finally {
        clearTimeout(requestTimer);
        if (active && generation === current) {
          if (terminal) {
            budget.next = 0;
            save(attemptId, budget);
          }
          busy = false;
          setResult((v) => (v?.id === attemptId ? { ...v, busy: false } : v));
          schedule();
        }
      }
    }
    function visibility() {
      if (document.hidden) {
        generation++;
        controller?.abort();
        busy = false;
        clearTimeout(timer);
      } else void poll();
    }
    refresh.current = () => void poll();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", visibility);
    void poll();
    return () => {
      active = false;
      generation++;
      controller?.abort();
      clearTimeout(timer);
      refresh.current = () => {};
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", visibility);
    };
  }, [attemptId, sessionRevision]);
  return {
    view:
      result?.id === attemptId && result.revision === sessionRevision
        ? result.view
        : "checking",
    busy:
      result?.id === attemptId && result.revision === sessionRevision
        ? result.busy
        : false,
    check,
  };
}
