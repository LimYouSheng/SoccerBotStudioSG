"use client";
import { BookingLoading } from "@/features/booking/booking-loading";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useBooking } from "@/features/booking/provider";
import { ProtectedConfirmation } from "@/features/booking/protected-confirmation";
function ConfirmationRoute() {
  const params = useSearchParams();
  const {
    reset,
    restartAfterConfirmation,
    confirmationRevision,
    bookingService,
  } = useBooking();
  return (
    <ProtectedConfirmation
      attemptId={params.get("attempt") || ""}
      sessionRevision={confirmationRevision}
      checkoutMode={bookingService.mode === "live" ? "live" : undefined}
      onAgain={reset}
      onRestart={restartAfterConfirmation}
    />
  );
}
export default function ConfirmationPage() {
  return (
    <Suspense
      fallback={<BookingLoading label="Checking your payment and booking…" />}
    >
      <ConfirmationRoute />
    </Suspense>
  );
}
