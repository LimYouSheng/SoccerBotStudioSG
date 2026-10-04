import type { Metadata, Viewport } from "next";
import { BookingProvider } from "@/features/booking/provider";
import { SiteShell } from "@/components/site-shell";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Book Now | SOCCERBOTSTUDIO Singapore",
    template: "%s | SOCCERBOTSTUDIO Singapore",
  },
  description:
    "Book the Kickoff Special: 40 minutes for up to four players, with Single, Team and Battle play and instructor guidance.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#050a2f" };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-SG">
      <body>
        <BookingProvider>
          <SiteShell>{children}</SiteShell>
        </BookingProvider>
      </body>
    </html>
  );
}
