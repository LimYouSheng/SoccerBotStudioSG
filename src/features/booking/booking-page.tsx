"use client";
import Link from "next/link";
import { sitePath } from "@/content/site-path";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { guardedStep, type BookingStep } from "@/domain/booking";
import { Icon } from "@/components/icon";
import { BookingLoading as BrandLoading } from "./booking-loading";
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
  const {
      ready,
      draft,
      attempt,
      now,
      bookingService,
      setCalendarBrowsing,
      action,
    } = useBooking(),
    router = useRouter();
  const handingOff =
    bookingService.mode === "live" &&
    step === "review" &&
    !!attempt &&
    (action.status === "loading" || action.status === "success") &&
    action.operation === "checkout";
  const reserving =
    bookingService.mode === "live" &&
    step === "details" &&
    action.operation === "reserve" &&
    action.status === "loading";
  const pendingReview = step === "details" && attempt?.verifying === true;
  const displayStep =
    step === "details" && (attempt?.verifying || attempt?.held)
      ? "review"
      : step;
  const actual =
      step === "details" && action.returnToCalendar
        ? "time"
        : handingOff || reserving
          ? step
          : bookingService.mode === "live" &&
              bookingService.operations.availability === "unavailable" &&
              step !== "account"
            ? "session"
            : bookingService.mode === "live" &&
                !attempt &&
                draft.mode &&
                ["review", "payment"].includes(step)
              ? "time"
              : guardedStep(step, draft, attempt, now),
    current = progress.findIndex(([id]) => id === displayStep);
  const retainingReview =
    step === "details" && actual === "review" && attempt?.held === true;
  useEffect(() => {
    if (!ready || actual === step) return;
    if (retainingReview) {
      // Review is already interactive. Commit its URL without remounting it
      // through the app-router loading boundary. Refresh still opens Review.
      window.history.replaceState(null, "", sitePath("/book/review/"));
    } else router.replace(`/book/${actual}/`);
  }, [actual, step, ready, router, retainingReview]);
  useEffect(() => {
    setCalendarBrowsing(["account", "session", "time"].includes(actual));
    return () => setCalendarBrowsing(true);
  }, [actual, setCalendarBrowsing]);
  // Review is already mounted after creation. Preserve it while the URL
  // catches up after verification; routing must not bring the overlay back.
  if (!ready || (actual !== step && !retainingReview))
    return <BrandLoading overlay={false} />;
  const Screen = screens[step];
  if (step === "payment" || step === "confirmation") return <Screen />;
  return (
    <div
      className={`booking-shell ${["account", "session", "review"].includes(displayStep) ? "session-shell" : ""}`}
    >
      {current >= 0 && (
        <>
          <div className="booking-top">
            {pendingReview ? (
              <span className="back" aria-disabled="true">
                <Icon name="back" />
                Back
              </span>
            ) : (
              <Link
                className="back"
                href={current > 0 ? `/book/${progress[current - 1][0]}/` : "/"}
              >
                <Icon name="back" />
                {current ? "Back" : "Back to home"}
              </Link>
            )}
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
                {index < current && !pendingReview ? (
                  <Link href={`/book/${id}/`} className="hover:underline">
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
          ["time", "details"].includes(displayStep)
            ? "booking-layout"
            : "booking-layout session-layout"
        }
      >
        <section className="booking-main min-w-0">
          <Screen />
        </section>
        {["time", "details"].includes(displayStep) && (
          <Summary basket={step === "time"} />
        )}
      </div>
    </div>
  );
}
