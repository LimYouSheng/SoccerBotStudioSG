import { ADDRESS, CONTACT } from "@/domain/catalog";
import { dateLabel, money } from "@/domain/dates";
import type { AssistantService } from "../contracts";
export const demoAssistantService: AssistantService = {
  reply(text, booking) {
    if (/cancel|change|reschedul|move|refund/i.test(text))
      return booking
        ? `For changes or cancellations to ${booking.reference}, contact the studio at ${CONTACT.phoneDisplay}. Your booking has not been changed. Refunds are handled by authorised studio staff.`
        : "Open your confirmed booking first, or contact the studio for help with an existing reservation.";
    if (/price|cost|rate|session|coach|player|pax/i.test(text))
      return "The Kickoff Special is S$88 per 40-minute session for 1–4 players. Full instructor guidance and Single, Team and Battle play are included.";
    if (/where|address|location|hour|open/i.test(text))
      return `${ADDRESS}. The preview schedule runs from 10 am to 10 pm. Please confirm live opening hours with the studio.`;
    if (/bring|wear|shoe|arriv/i.test(text))
      return "Arrive 10 minutes early in comfortable sportswear and suitable footwear. Have your SoccerBot Player App profile ready. Contact the studio about specific access needs.";
    if (/group|corporate|school|membership|sponsor/i.test(text))
      return "Use Contact us to enquire about multi-session bundles, memberships, academy visits, corporate bookings and sponsorship arrangements.";
    if (/booking|reference|receipt|reservation/i.test(text))
      return booking
        ? `${booking.reference}: ${booking.slots.map((slot) => `${dateLabel(slot.date)} at ${slot.start}, ${slot.studio}`).join("; ")}. ${money(booking.totalCents)}. This is your confirmed preview booking.`
        : "No confirmed booking is available in this browser. You can start a booking or contact the studio.";
    return `I can help with sessions, prices, location and your preview booking. To contact the studio, call ${CONTACT.phoneDisplay} or email ${CONTACT.email}.`;
  },
};
