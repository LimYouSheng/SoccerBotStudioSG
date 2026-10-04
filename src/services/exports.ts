import { ADDRESS, INSTRUCTORS, SERVICE_NAME } from "@/domain/catalog";
import { dateLabel, endTime, money } from "@/domain/dates";
import type { Booking } from "@/domain/booking";
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const escapeICS = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
function utcTime(date: string, time: string) {
  return new Date(`${date}T${time}:00+08:00`)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z/, "Z");
}
export function calendarText(booking: Booking): string {
  const stamp = new Date(booking.createdAt)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SoccerBotStudio//Booking Preview//EN",
    "CALSCALE:GREGORIAN",
    ...booking.slots.flatMap((slot, i) => [
      "BEGIN:VEVENT",
      `UID:${booking.reference}-${i}@soccerbotstudio`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcTime(slot.date, slot.start)}`,
      `DTEND:${utcTime(slot.date, endTime(slot.start))}`,
      `SUMMARY:${escapeICS(SERVICE_NAME)}`,
      `LOCATION:${escapeICS(`${slot.studio}, ${ADDRESS}`)}`,
      `DESCRIPTION:${escapeICS(`Preview booking ${booking.reference}. Instructor: ${booking.draft.instructor ? INSTRUCTORS[booking.draft.instructor].name : "To be confirmed"}. Arrive 10 minutes early.`)}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  // RFC 5545: fold content lines below 75 octets without splitting UTF-8 characters.
  return (
    lines
      .map((line) => {
        let result = "",
          current = "";
        for (const char of line) {
          if (new TextEncoder().encode(current + char).length > 74) {
            result += current + "\r\n";
            current = " ";
          }
          current += char;
        }
        return result + current;
      })
      .join("\r\n") + "\r\n"
  );
}
export function downloadCalendar(booking: Booking) {
  download(
    new Blob([calendarText(booking)], { type: "text/calendar;charset=utf-8" }),
    `${booking.reference}.ics`,
  );
}
export async function downloadBooking(booking: Booking) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  let y = 20;
  const line = (text: string, size = 11) => {
    pdf.setFontSize(size);
    const rows: string[] = pdf.splitTextToSize(text, 174);
    for (const row of rows) {
      if (y > 275) {
        pdf.addPage();
        y = 20;
      }
      pdf.text(row, 18, y);
      y += size * 0.48 + 2;
    }
  };
  line("SOCCERBOTSTUDIO Singapore", 19);
  line("Booking preview - no money charged", 10);
  y += 6;
  line(booking.reference, 15);
  line(SERVICE_NAME);
  line(
    `${booking.draft.players} players | Instructor: ${booking.draft.instructor ? INSTRUCTORS[booking.draft.instructor].name : "To be confirmed"}`,
  );
  line(ADDRESS);
  y += 5;
  booking.slots.forEach((slot) =>
    line(
      `${dateLabel(slot.date)} | ${slot.start}-${endTime(slot.start)} SGT | ${slot.studio}`,
    ),
  );
  y += 5;
  line(`Total: ${money(booking.totalCents)} (SGD, inclusive of GST)`, 13);
  line(
    `Contact: ${booking.draft.contact.name} | ${booking.draft.contact.email} | ${booking.draft.contact.phone}`,
  );
  line(
    `Lead participant: ${booking.draft.contact.self ? booking.draft.contact.name : booking.draft.contact.participant}`,
  );
  line(
    `Emergency contact: ${booking.draft.contact.emergencyName} | ${booking.draft.contact.emergencyPhone}`,
  );
  if (booking.draft.contact.requirements)
    line(`Access/support: ${booking.draft.contact.requirements}`);
  if (booking.draft.contact.notes)
    line(`Notes: ${booking.draft.contact.notes}`);
  y += 5;
  line(
    "Arrive 10 minutes early. Have your SoccerBot Player App profile and QR card ready.",
  );
  pdf.save(`${booking.reference}.pdf`);
}
