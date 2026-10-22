import { notFound } from "next/navigation";
import { BOOKING_STEPS, type BookingStep } from "@/domain/booking";
import { BookingPage } from "@/features/booking/booking-page";
export const dynamicParams = false;
/** Enumerate the booking steps included in the static export. */
export function generateStaticParams() {
  return BOOKING_STEPS.map((step) => ({ step }));
}
/** Render the requested booking step within its suspense boundary. */
export default async function Page({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  if (!BOOKING_STEPS.includes(step as BookingStep)) notFound();
  return <BookingPage step={step as BookingStep} />;
}
