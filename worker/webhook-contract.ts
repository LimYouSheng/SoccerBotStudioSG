import { z } from "zod";

// Fixed operator-selected delivery channels. A route is a diagnostic label,
// not a signed payload event type or proof of payment/booking association.
export const webhookEvent = z.enum(["new_booking", "new_invoice"]);
export type WebhookEvent = z.infer<typeof webhookEvent>;
export function webhookPath(event: WebhookEvent) {
  return event === "new_invoice"
    ? "/api/provider/webhook/new_invoice"
    : "/api/provider/webhook";
}
export function webhookRoute(path: string): WebhookEvent | undefined {
  if (path === webhookPath("new_booking")) return "new_booking";
  if (path === webhookPath("new_invoice")) return "new_invoice";
  return undefined;
}
