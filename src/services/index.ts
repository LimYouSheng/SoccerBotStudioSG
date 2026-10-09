// Build-time composition only. No URL, browser storage or failed request can select Preview.
import { liveBookingService, liveCatalogueService } from "./booking";
import { liveCustomerIdentity } from "./identity";
import { demoCustomerIdentity } from "./demo/identity";
import { demoBookingService } from "./demo/booking";
import { demoIdentityService } from "./demo/identity";
import { demoEnquiryService } from "./demo/enquiry";
import { demoAssistantService } from "./demo/assistant";
const mode = process.env.NEXT_PUBLIC_BOOKING_MODE ?? "demo";
if (mode !== "demo" && mode !== "live")
  throw new Error("Unsupported booking mode");
export const services = {
  booking: mode === "live" ? liveBookingService : demoBookingService,
  identity: demoIdentityService,
  customerIdentity:
    mode === "live" ? liveCustomerIdentity : demoCustomerIdentity,
  enquiry: demoEnquiryService,
  assistant: demoAssistantService,
};

// Available for an explicitly composed future live journey; never selected by a URL or failed request.
export const bookingAdapters = {
  demo: demoBookingService,
  live: liveBookingService,
} as const;

export const catalogueService = liveCatalogueService;
