"use client";
import { isHitpayCheckoutUrl } from "@/domain/native-checkout";
import { BookingLoading as BrandLoading } from "./booking-loading";
import { BrandLoading as InlineLoading } from "@/components/brand-loading";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookingConfirmation } from "./confirmation-step";
import { downloadBooking, downloadCalendar } from "@/services/exports";
type BookingReceipt = Awaited<ReturnType<typeof readBookingReceipt>>;
import { sitePath } from "@/content/site-path";
import {
  readBookingReceipt,
  dismissCompletedBooking,
  expireBooking,
  bookingFromReceipt,
  protectedCheckoutService,
} from "@/services/confirmation";
import type { CheckoutContext } from "@/services/contracts";
import { money } from "@/domain/dates";
import { useConfirmationChecking } from "./confirmation-checking";
export function ProtectedConfirmation({
  attemptId,
  checkoutMode,
  sessionRevision = 0,
  onAgain,
  onRestart,
  onExpired,
}: {
  attemptId: string;
  checkoutMode?: "synthetic" | "live";
  sessionRevision?: number;
  onAgain?: () => void;
  onExpired?: (attemptId: string) => void;
  onRestart?: (attemptId: string) => void;
}) {
  const router = useRouter();
  const [context, setContext] = useState<{
    value: CheckoutContext;
    revision: number;
  } | null>(null);
  const contextMatches =
    context?.value.attemptId === attemptId &&
    context.value.mode === checkoutMode &&
    context.revision === sessionRevision;
  const saved = contextMatches ? context.value.confirmation : undefined;
  const [contextFailure, setContextFailure] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const contextSettled =
    contextMatches ||
    (contextFailure?.id === attemptId &&
      contextFailure.revision === sessionRevision);
  const {
    view,
    busy,
    check,
    bindWindow,
    paymentReceived,
    customerConfirmation,
    expired,
  } = useConfirmationChecking(
    attemptId,
    sessionRevision,
    (!checkoutMode || contextSettled) && !saved,
    contextMatches ? context.value.checking.deadlineMs : undefined,
  );
  const [receipt, setReceipt] = useState<{
    value: BookingReceipt;
    revision: number;
  } | null>(null);
  const receiptWork = useRef<AbortController | null>(null);
  const [receiptFailure, setReceiptFailure] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const [receiptRead, setReceiptRead] = useState(0);
  const exportWaiter = useRef<{
    resolve: () => void;
    reject: () => void;
  } | null>(null);
  useEffect(() => {
    if (
      receipt?.value.attemptId === attemptId &&
      receipt.revision === sessionRevision
    ) {
      exportWaiter.current?.resolve();
      exportWaiter.current = null;
    } else if (
      ["denied", "unresolved", "unavailable"].includes(view) ||
      receiptFailure
    ) {
      exportWaiter.current?.reject();
      exportWaiter.current = null;
    }
  }, [receipt, receiptFailure, view, attemptId, sessionRevision]);
  useEffect(
    () => () => {
      exportWaiter.current?.reject();
      exportWaiter.current = null;
    },
    [attemptId, sessionRevision],
  );
  const finishExpiry = useEffectEvent(() => {
    onExpired?.(attemptId);
    router.replace("/book/time/");
  });
  const expiryWork = useRef<{ id: string; work: Promise<void> } | null>(null);
  const wantsExpiry =
    expired || (contextMatches && context.value.expired === true);
  const [expiryFailure, setExpiryFailure] = useState(false);
  useEffect(() => {
    if (!wantsExpiry) return;
    if (expiryWork.current?.id !== attemptId)
      expiryWork.current = { id: attemptId, work: expireBooking(attemptId) };
    let active = true;
    void expiryWork.current.work.then(
      () => {
        if (!active) return;
        finishExpiry();
      },
      () => {
        if (active) setExpiryFailure(true);
      },
    );
    return () => {
      active = false;
    };
  }, [wantsExpiry, attemptId, sessionRevision]);
  useEffect(() => {
    if (view !== "confirmed" || checkoutMode === "synthetic") return;
    const controller = new AbortController();
    receiptWork.current = controller;
    void readBookingReceipt(attemptId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setReceipt({ value, revision: sessionRevision });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setReceiptFailure({ id: attemptId, revision: sessionRevision });
      });
    return () => controller.abort();
  }, [attemptId, view, checkoutMode, sessionRevision, receiptRead]);
  const [expiredLink, setExpiredLink] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [preparation, setPreparation] = useState("loading");
  useEffect(() => {
    if (!checkoutMode) return;
    let active = true;
    const controller = new AbortController();
    void protectedCheckoutService
      .context({ attemptId, mode: checkoutMode, signal: controller.signal })
      .then(
        (value) => {
          if (active) {
            bindWindow(value.checking);
            setContext({ value, revision: sessionRevision });
            setPreparation("ready");
          }
        },
        () => {
          if (active) {
            setPreparation("unavailable");
            setContextFailure({ id: attemptId, revision: sessionRevision });
          }
        },
      );
    return () => {
      active = false;
      controller.abort();
    };
  }, [attemptId, checkoutMode, sessionRevision, bindWindow]);
  const current =
    context?.value.attemptId === attemptId &&
    context.value.mode === checkoutMode &&
    context.revision === sessionRevision &&
    view !== "denied"
      ? context.value
      : null;
  useEffect(() => {
    if (current) bindWindow(current.checking);
  }, [current, bindWindow, contextSettled]);
  useEffect(
    () => () => receiptWork.current?.abort(),
    [attemptId, sessionRevision],
  );
  const link =
    current?.checkout.state === "available" ? current.checkout : null;
  useEffect(() => {
    if (!link?.expiresAtMs) return;
    const timer = setTimeout(
      () => setExpiredLink(link.url),
      Math.max(0, link.expiresAtMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [link]);
  const recordedPayment = current?.payment;
  const historicalPayment =
    !!recordedPayment && ["unresolved", "unavailable"].includes(view);
  const showLink =
    !recordedPayment &&
    current?.checkout.state === "available" &&
    current.checkout.url !== expiredLink &&
    !["confirmed", "denied", "unresolved"].includes(view);
  const customerProof = !["denied", "unresolved"].includes(view)
    ? (customerConfirmation ??
      (contextMatches ? context.value.customerConfirmation : undefined))
    : undefined;
  const displayedReceipt = saved
    ? bookingFromReceipt(saved)
    : view === "confirmed" &&
        receipt?.value.attemptId === attemptId &&
        receipt.revision === sessionRevision
      ? receipt.value
      : customerProof
        ? bookingFromReceipt(customerProof)
        : null;
  if (displayedReceipt && checkoutMode !== "synthetic") {
    const exportReceipt = async (format: "calendar" | "details") => {
      const controller =
        receiptWork.current && !receiptWork.current.signal.aborted
          ? receiptWork.current
          : new AbortController();
      receiptWork.current = controller;
      if (!controller || controller.signal.aborted)
        throw new Error("receipt_unavailable");
      if (customerProof && view !== "confirmed" && !saved) {
        if (["unresolved", "unavailable", "denied"].includes(view))
          throw new Error("receipt_unavailable");
        await new Promise<void>((resolve, reject) => {
          exportWaiter.current = {
            resolve,
            reject: () => reject(new Error("receipt_unavailable")),
          };
        });
      }
      const current = await readBookingReceipt(attemptId, controller.signal);
      if (controller.signal.aborted) throw new Error("receipt_unavailable");
      if (format === "calendar") downloadCalendar(current.booking, false);
      else
        await downloadBooking(
          current.booking,
          false,
          current.taxMinor,
          controller.signal,
        );
    };
    return (
      <BookingConfirmation
        booking={displayedReceipt.booking}
        taxMinor={displayedReceipt.taxMinor}
        verifiedAtMs={customerProof?.verifiedAtMs ?? saved?.verifiedAtMs}
        onAgain={async () => {
          if (onRestart) {
            onRestart(attemptId);
            router.push("/book/account/");
            return;
          }
          if (checkoutMode === "live") await dismissCompletedBooking(attemptId);
          onAgain?.();
          window.location.assign(sitePath("/book/account/"));
        }}
        onHome={async () => {
          if (onRestart) {
            onRestart(attemptId);
            router.push("/");
            return;
          }
          if (checkoutMode === "live") await dismissCompletedBooking(attemptId);
          onAgain?.();
          window.location.assign(sitePath("/"));
        }}
        calendarDownload={() => exportReceipt("calendar")}
        detailsDownload={() => exportReceipt("details")}
      />
    );
  }
  if (expiryFailure)
    return (
      <p role="alert">
        Payment status is still being checked. Your original booking has been
        kept.
      </p>
    );
  const receiptUnavailable =
    receiptFailure?.id === attemptId &&
    receiptFailure.revision === sessionRevision;
  if (
    (view === "checking" &&
      !(showLink && link && !isHitpayCheckoutUrl(link.url))) ||
    (view === "confirmed" &&
      checkoutMode !== "synthetic" &&
      !receiptUnavailable)
  ) {
    const pendingLabel =
      view === "confirmed"
        ? "Preparing your confirmation…"
        : checkoutMode && preparation === "loading"
          ? "Preparing checkout…"
          : paymentReceived
            ? "Payment received—verifying booking…"
            : "Verifying your payment…";
    if (current?.details) {
      const details = bookingFromReceipt(current.details);
      return (
        <BookingConfirmation
          booking={details.booking}
          taxMinor={details.taxMinor}
          pending
          pendingLabel={pendingLabel}
          onAgain={() => {}}
        />
      );
    }
    return (
      <div className="status-shell">
        <section className="surface confirmation-card" aria-busy="true">
          <h1>Booking confirmation</h1>
          <InlineLoading compact label={pendingLabel} />
          <p className="text-sm text-muted">{pendingLabel}</p>
          <p>
            We’re checking the payment status for this booking. Your details are
            saved.
          </p>
          {current && <ConfirmationSummary summary={current.summary} />}
        </section>
      </div>
    );
  }
  return (
    <div className="status-shell">
      <section className="surface confirmation-card" aria-live="polite">
        {checkoutMode === "synthetic" && (
          <p className="payment-foot">
            Experiment 1 · Synthetic Preview · No payment or booking is made
          </p>
        )}
        <h1>
          {historicalPayment ? (
            "Payment received"
          ) : paymentReceived && view !== "confirmed" && view !== "denied" ? (
            "Payment received; booking confirmation pending"
          ) : view === "checking" ? (
            showLink && link && !isHitpayCheckoutUrl(link.url) ? (
              "Complete your payment"
            ) : (
              <BrandLoading
                compact
                label={
                  checkoutMode && preparation === "loading"
                    ? "Preparing checkout…"
                    : "Verifying your payment…"
                }
              />
            )
          ) : view === "confirmed" ? (
            "Booking confirmed"
          ) : view === "unresolved" ? (
            "Payment status unresolved"
          ) : (
            "Confirmation unavailable"
          )}
        </h1>
        <p>
          {historicalPayment
            ? "Your payment was verified and recorded. Contact the studio if you need the latest booking status. Do not pay again."
            : view === "confirmed"
              ? "Your payment and booking have been verified."
              : view === "denied"
                ? "Your access has expired or was revoked. Contact the studio to recover access before trying another payment."
                : view === "checking"
                  ? "Please wait while we verify your booking."
                  : view === "unavailable"
                    ? "Status checking is temporarily unavailable. Your information is preserved. You can check again shortly."
                    : "We haven’t resolved your previous payment yet. Your booking attempt and details are saved. Another checkout remains unavailable until its payment outcome is verified. The checking deadline does not cancel payment."}
        </p>
        {historicalPayment && recordedPayment && (
          <p>
            Payment verified:{" "}
            {new Intl.DateTimeFormat("en-SG", {
              timeZone: "Asia/Singapore",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(recordedPayment.paidAtMs)}{" "}
            (Singapore time)
          </p>
        )}
        {view === "confirmed" && receiptUnavailable && (
          <div role="alert">
            <p>
              Your booking is confirmed, but its details could not be loaded.
            </p>
            <button
              className="button"
              onClick={() => {
                setReceiptFailure(null);
                setReceiptRead((value) => value + 1);
              }}
            >
              Load booking details
            </button>
          </div>
        )}
        {current && <ConfirmationSummary summary={current.summary} />}
        {checkoutMode &&
          !recordedPayment &&
          !(link && isHitpayCheckoutUrl(link.url)) && (
            <>
              <p>
                Checkout opens separately. Your browser may use a tab or window.
                Return to SoccerBot to check progress; opening or closing
                checkout does not confirm payment.
              </p>
              {showLink && current?.checkout.state === "available" ? (
                <a
                  className="button wide"
                  href={current.checkout.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  onClick={(event) => {
                    if (link?.expiresAtMs && Date.now() >= link.expiresAtMs) {
                      event.preventDefault();
                      setExpiredLink(link.url);
                    } else setOpened(attemptId);
                  }}
                >
                  {opened === attemptId
                    ? "Open checkout again"
                    : "Open checkout"}
                </a>
              ) : view === "checking" || view === "unavailable" ? (
                <p role="status">
                  {preparation === "loading" ? (
                    <BrandLoading compact label="Preparing checkout…" />
                  ) : (
                    "Checkout unavailable. Do not start another payment."
                  )}
                </p>
              ) : null}
            </>
          )}
        {!["confirmed", "unresolved", "denied"].includes(view) && (
          <button
            className="button secondary wide payment-status-action"
            disabled={busy}
            onClick={check}
          >
            {busy ? (
              <BrandLoading compact label="Checking status…" />
            ) : (
              "Check status"
            )}
          </button>
        )}
      </section>
    </div>
  );
}

function ConfirmationSummary({
  summary,
}: {
  summary: CheckoutContext["summary"];
}) {
  return (
    <section aria-label="Current booking summary">
      <h2 className="section-title">Your booking</h2>
      <p>
        {summary.players} players · {summary.sessions.length} session
        {summary.sessions.length === 1 ? "" : "s"}
      </p>
      <ul>
        {summary.sessions.map((session, index) => (
          <li key={index}>
            {new Intl.DateTimeFormat("en-SG", {
              timeZone: "Asia/Singapore",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(session.startMs)}{" "}
            · {session.players} players
          </li>
        ))}
      </ul>
      <p className="line-item total">
        Total <strong>{money(summary.totalMinor)}</strong>
      </p>
    </section>
  );
}
