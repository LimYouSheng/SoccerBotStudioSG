"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { guardedStep, type BookingStep } from "@/domain/booking";
import { Icon } from "@/components/icon";
import { BrandLoading } from "@/components/brand-loading";
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
  if (!ready || actual !== step) return <BrandLoading overlay={false} />;
  const Screen = screens[step];
  return (
    <div
      className={`booking-shell min-h-[65vh] ${["account", "session", "review"].includes(step) ? "session-shell" : ""}`}
    >
      {current >= 0 && (
        <>
          <div className="booking-top">
            <Link
              className="back"
              href={current > 0 ? `/book/${progress[current - 1][0]}/` : "/"}
            >
              <Icon name="back" />
              {current ? "Back" : "Back to home"}
            </Link>
            <span className="eyebrow text-muted">Booking</span>
          </div>
          <ol className="progress" aria-label="Booking progress">
            {progress.map(([id, label], index) => (
              <li
                key={id}
                aria-current={index === current ? "step" : undefined}
                className={
                  index === current ? "active" : index < current ? "done" : ""
                }
              >
                <span className="step-number">
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
            ? "booking-layout"
            : "booking-layout session-layout"
        }
      >
        <section className="booking-main min-w-0">
          <Screen />
        </section>
        {["time", "details"].includes(step) && (
          <Summary basket={step === "time"} />
        )}
      </div>
    </div>
  );
}
