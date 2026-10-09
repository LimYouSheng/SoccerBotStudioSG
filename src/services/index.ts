// Explicit composition. The approved customer journey remains Preview; no runtime mode toggle.
import { liveBookingService, liveCatalogueService } from "./booking";
import { demoBookingService } from "./demo/booking";
import { demoIdentityService } from "./demo/identity";
import { demoEnquiryService } from "./demo/enquiry";
import { demoAssistantService } from "./demo/assistant";
export const services = {
  booking: demoBookingService,
  identity: demoIdentityService,
  enquiry: demoEnquiryService,
  assistant: demoAssistantService,
};

// Available for an explicitly composed future live journey; never selected by a URL or failed request.
export const bookingAdapters = {
  demo: demoBookingService,
  live: liveBookingService,
} as const;

export const catalogueService = liveCatalogueService;
