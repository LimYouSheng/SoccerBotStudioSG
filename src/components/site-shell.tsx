"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ADDRESS, CONTACT, LOCATION, PLAYER_APP_URL } from "@/domain/catalog";
import { darkLogo, logo } from "@/content/media";
import { useBooking } from "@/features/booking/provider";
import { Assistant } from "@/features/assistant/assistant";
import { Dialog } from "./dialog";
import { BookingLink } from "./booking-navigation";
import { PlayerAppPrompt } from "./player-app-prompt";
import { Icon } from "./icon";
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    router = useRouter(),
    booking = useBooking();
  const [dialog, setDialog] = useState<"leave" | "disclaimer" | null>(null);
  function home(event: React.MouseEvent<HTMLAnchorElement>) {
    if (
      pathname.startsWith("/book/") &&
      booking.draft.mode &&
      booking.attempt?.status !== "paid"
    ) {
      event.preventDefault();
      setDialog("leave");
    }
  }
  return (
    <>
      <a
        href="#main"
        className="fixed -top-20 left-4 z-50 rounded bg-white p-4 text-ink focus:top-3"
      >
        Skip to content
      </a>
      <header className="site-header">
        <nav className="nav" aria-label="Main navigation">
          <Link
            href="/"
            onClick={home}
            className="brand"
            aria-label="SOCCERBOTSTUDIO Singapore home"
          >
            <img
              src={logo}
              alt="SOCCERBOTSTUDIO Singapore"
              width={565}
              height={190}
              className="official-logo"
            />
          </Link>
          <div className="nav-links" hidden={pathname.startsWith("/book/")}>
            <BookingLink
              href="/studio/"
              className="nav-studio"
              aria-current={pathname === "/studio/" ? "page" : undefined}
            >
              The studio
            </BookingLink>
            <a
              href={PLAYER_APP_URL}
              className="nav-download"
              target="_blank"
              rel="noreferrer"
            >
              Download app
            </a>
            <BookingLink href="/book/account/" className="nav-book">
              Book now
            </BookingLink>
          </div>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="footer-contact-band">
          <div className="footer-brand">
            <img
              src={darkLogo}
              alt="SOCCERBOTSTUDIO Singapore"
              width={565}
              height={190}
              className="footer-logo"
              loading="lazy"
            />
          </div>
          <div className="footer-contact-grid">
            <div className="footer-contact-row">
              <span className="footer-contact-icon">
                <Icon name="location" />
              </span>
              <span className="footer-contact-copy">
                <span className="footer-contact-heading">
                  <strong>Find Us</strong>
                </span>
                <a
                  className="footer-contact-detail footer-detail-link"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ADDRESS)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {LOCATION.street}
                  <br />
                  {LOCATION.unit}
                  <span className="footer-address-building">
                    {" "}
                    {LOCATION.building}
                  </span>{" "}
                  · {LOCATION.postal}
                </a>
              </span>
            </div>
            <div className="footer-contact-row">
              <span className="footer-contact-icon">
                <Icon name="instagram" />
              </span>
              <span className="footer-contact-copy">
                <span className="footer-contact-heading">
                  <strong>Connect With Us</strong>
                </span>
                <a
                  className="footer-contact-detail footer-detail-link"
                  href={CONTACT.instagram}
                  target="_blank"
                  rel="noreferrer"
                >
                  @soccerbotstudiosg
                </a>
              </span>
            </div>
            <div className="footer-contact-row footer-direct-contact">
              <span className="footer-contact-icon">
                <Icon name="mail" />
              </span>
              <span className="footer-contact-copy">
                <span className="footer-contact-heading">
                  <strong>Contact Us</strong>
                </span>
                <span className="footer-contact-detail footer-direct-links">
                  <a href={`tel:${CONTACT.phone}`}>{CONTACT.phoneDisplay}</a>
                  <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
                </span>
              </span>
            </div>
          </div>
        </div>
        <div className="footer-inner">
          <span>© 2026 SOCCERBOTSTUDIO Singapore. All rights reserved.</span>
          <div className="footer-links">
            <Link href="/enquiry/">Get in touch</Link>
            <button onClick={() => setDialog("disclaimer")}>Disclaimer</button>
          </div>
        </div>
      </footer>
      <Assistant />
      <PlayerAppPrompt />
      {dialog && (
        <Dialog
          title={
            dialog === "leave" ? "Leave this booking?" : "General disclaimer"
          }
          onClose={() => setDialog(null)}
        >
          {dialog === "leave" ? (
            <>
              <p className="mb-5 text-muted">
                Your current selections are saved in this browser. Any payment
                in progress remains available when you return.
              </p>
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setDialog(null);
                    router.push("/");
                  }}
                >
                  Back to home
                </button>
                <button className="button" onClick={() => setDialog(null)}>
                  Stay
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-4">
                Football and physical activity involve risks. Follow your
                instructor’s directions and discuss any support requirements
                with the studio.
              </p>
              <p>
                This website is a booking preview. No payment is collected,
                booking submitted or enquiry sent.
              </p>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
