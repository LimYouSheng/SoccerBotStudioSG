"use client";
import { PendingConfirmation } from "@/features/booking/confirmation-step";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useBooking } from "@/features/booking/provider";
import { ProtectedConfirmation } from "@/features/booking/protected-confirmation";
/** Resolve the attempt parameter into a protected confirmation view. */
function ConfirmationRoute() {
  const params = useSearchParams();
  const {
    reset,
    restartAfterConfirmation,
    restartAfterExpiry,
    confirmationRevision,
    bookingService,
  } = useBooking();
  return (
    <ProtectedConfirmation
      attemptId={params.get("attempt") || ""}
      sessionRevision={confirmationRevision}
      checkoutMode={bookingService.mode === "live" ? "live" : undefined}
      onExpired={restartAfterExpiry}
      onAgain={reset}
      onRestart={restartAfterConfirmation}
    />
  );
}
/** Render the confirmation route with a loading boundary. */
export default function ConfirmationPage() {
  return (
    <Suspense fallback={<PendingConfirmation />}>
      <ConfirmationRoute />
    </Suspense>
  );
}
