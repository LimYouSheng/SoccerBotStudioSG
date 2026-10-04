"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { guardedStep, type BookingStep } from "@/domain/booking";
import { Icon } from "@/components/icon";
import { logo } from "@/content/media";
import { useBooking } from "./provider";
import { AccountStep } from "./account-step";
import { SessionStep } from "./session-step";
import { TimeStep } from "./time-step";
import { DetailsStep } from "./details-step";
import { ReviewStep } from "./review-step";
import { PaymentStep } from "./payment-step";
import { ConfirmationStep } from "./confirmation-step";
import { Summary } from "./summary";
const progress: Array<[BookingStep, string]> = [
  ["account", "Booking"],
  ["session", "Session"],
  ["time", "Time"],
  ["details", "Details"],
  ["review", "Review"],
];
const screens = {
  account: AccountStep,
  session: SessionStep,
  time: TimeStep,
  details: DetailsStep,
  review: ReviewStep,
  payment: PaymentStep,
  confirmation: ConfirmationStep,
};
export function BookingPage({ step }: { step: BookingStep }) {
  const { ready, draft, attempt } = useBooking(),
    router = useRouter();
  const actual = guardedStep(step, draft, attempt),
    current = progress.findIndex(([id]) => id === step);
  useEffect(() => {
    if (ready && actual !== step) router.replace(`/book/${actual}/`);
  }, [actual, step, ready, router]);
  if (!ready || actual !== step)
    return (
      <div className="grid min-h-[65vh] place-content-center" role="status">
        <img
          src={logo}
          width={565}
          height={190}
          className="w-60"
          alt="Loading booking"
        />
      </div>
    );
  const Screen = screens[step],
    wide = ["time", "details", "payment"].includes(step);
  return (
    <div
      className={`mx-auto min-h-[65vh] px-5 py-7 sm:px-10 sm:py-10 ${wide ? "max-w-[1240px]" : "max-w-[960px]"}`}
    >
      {current >= 0 && (
        <>
          <div className="mb-7 flex items-center justify-between">
            <Link
              className="back"
              href={current > 0 ? `/book/${progress[current - 1][0]}/` : "/"}
            >
              <Icon name="back" />
              {current ? "Back" : "Back to home"}
            </Link>
            <span className="eyebrow text-muted">Booking</span>
          </div>
          <ol
            className="mb-9 grid grid-cols-5 gap-1 border-b border-line pb-6"
            aria-label="Booking progress"
          >
            {progress.map(([id, label], index) => (
              <li
                key={id}
                aria-current={index === current ? "step" : undefined}
                className={`flex flex-col items-center gap-2 text-[11px] sm:flex-row sm:text-sm ${index === current ? "font-bold text-action" : "text-muted"}`}
              >
                <span
                  className={`grid h-7 w-7 place-items-center rounded-full border text-xs ${index <= current ? "border-action bg-action text-white" : "border-line"}`}
                >
                  {index < current ? (
                    <Icon name="check" className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </span>
                {index < current ? (
                  <Link href={`/book/${id}/`} className="py-2 hover:underline">
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      <div
        className={
          ["time", "details"].includes(step)
            ? "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_330px]"
            : ""
        }
      >
        <section className="min-w-0">
          <Screen />
        </section>
        {["time", "details"].includes(step) && (
          <Summary basket={step === "time"} />
        )}
      </div>
    </div>
  );
}
