"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useBooking } from "@/features/booking/provider";
import { ProtectedConfirmation } from "@/features/booking/protected-confirmation";
function ConfirmationRoute() {
  const params = useSearchParams();
  const { reset, confirmationRevision } = useBooking();
  return (
    <ProtectedConfirmation
      attemptId={params.get("attempt") || ""}
      sessionRevision={confirmationRevision}
      onAgain={reset}
    />
  );
}
export default function ConfirmationPage() {
  return (
    <Suspense fallback={<p>Checking your payment and booking…</p>}>
      <ConfirmationRoute />
    </Suspense>
  );
}
