"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProtectedConfirmation } from "@/features/booking/protected-confirmation";
function ConfirmationRoute() {
  const params = useSearchParams();
  return <ProtectedConfirmation attemptId={params.get("attempt") || ""} />;
}
export default function ConfirmationPage() {
  return (
    <Suspense fallback={<p>Checking your payment and booking…</p>}>
      <ConfirmationRoute />
    </Suspense>
  );
}
