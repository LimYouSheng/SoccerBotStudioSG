// Composition root. There is deliberately no production-mode toggle or implicit provider fallback.
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
