import { z } from "zod";
export const providerReferencesSchema = z.strictObject({
  bookingIds: z.array(z.string().min(1).max(128)).min(1).max(12),
  invoiceId: z.string().min(1).max(128),
});
