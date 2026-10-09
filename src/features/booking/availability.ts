"use client";
import { useEffect, useState } from "react";
import {
  BookingServiceError,
  type AvailableSlot,
  type BookingService,
} from "@/services/contracts";

type Result =
  | {
      owner: BookingService;
      key: string;
      dates: string[];
      status: "success";
      slots: AvailableSlot[];
    }
  | {
      owner: BookingService;
      key: string;
      dates: string[];
      status: "failure" | "unavailable" | "cancelled";
      message: string;
    };
// BookingProvider is the sole query owner. Calendar, basket and instructor cards
// share one read per distinct date in this input revision. No persistent cache.
export function useBookingAvailability(
  service: BookingService,
  dates: string[],
  players: number,
  scope: string,
  minute: number,
  sessionKey: () => string,
) {
  const datesKey = JSON.stringify([...new Set(dates)].sort());
  const session = sessionKey();
  const key = JSON.stringify([
    service.mode,
    datesKey,
    players,
    scope,
    minute,
    session,
  ]);
  const [result, setResult] = useState<Result | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const requested: string[] = JSON.parse(datesKey);
    void Promise.all(
      requested.map((date) =>
        service.availability({ date, players, signal: controller.signal }),
      ),
    ).then(
      (values) => {
        if (current && !controller.signal.aborted)
          setResult(
            sessionKey() === session
              ? {
                  owner: service,
                  key,
                  dates: requested,
                  status: "success",
                  slots: values.flat(),
                }
              : {
                  owner: service,
                  key,
                  dates: requested,
                  status: "cancelled",
                  message:
                    "Your session has changed. Please check availability again.",
                },
          );
      },
      (error) => {
        if (!current || controller.signal.aborted) return;
        const known = error instanceof BookingServiceError ? error : null;
        setResult({
          owner: service,
          key,
          dates: requested,
          status:
            known?.code === "unavailable"
              ? "unavailable"
              : known?.code === "cancelled"
                ? "cancelled"
                : "failure",
          message:
            known?.message ??
            "We couldn’t check availability. Please try again.",
        });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [service, datesKey, players, key, reload, session, sessionKey]);
  return {
    result: result?.key === key && result.owner === service ? result : null,
    retry() {
      setResult(null);
      setReload((value) => value + 1);
    },
  };
}
