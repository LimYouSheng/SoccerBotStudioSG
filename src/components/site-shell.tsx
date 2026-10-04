"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ADDRESS, CONTACT, LOCATION } from "@/domain/catalog";
import { logo } from "@/content/media";
import { useBooking } from "@/features/booking/provider";
import { Assistant } from "@/features/assistant/assistant";
import { Dialog } from "./dialog";
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
      <header className="bg-navy text-white">
        <nav
          className="mx-auto flex min-h-[88px] max-w-[1240px] flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-10"
          aria-label="Main navigation"
        >
          <Link
            href="/"
            onClick={home}
            aria-label="SOCCERBOTSTUDIO Singapore home"
          >
            <img
              src={logo}
              alt="SOCCERBOTSTUDIO Singapore"
              width={565}
              height={190}
              className="w-[190px] mix-blend-screen sm:w-[224px]"
            />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/studio/"
              className="nav-link"
              aria-current={pathname === "/studio/" ? "page" : undefined}
            >
              The studio
            </Link>
            <Link href="/book/account/" className="nav-link bg-action">
              Book now <Icon name="arrow" className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="border-t border-[#26374f] bg-navy text-slate-300">
        <div className="mx-auto grid max-w-[1240px] gap-8 px-6 py-12 sm:grid-cols-[.8fr_1fr_1fr] sm:px-10">
          <img
            src={logo}
            alt="SOCCERBOTSTUDIO Singapore"
            width={565}
            height={190}
            className="w-56 mix-blend-screen"
            loading="lazy"
          />
          <div className="flex gap-4">
            <Icon name="location" />
            <div>
              <h2 className="mb-3 font-sans text-sm font-bold not-italic tracking-normal text-white">
                Find Us
              </h2>
              <a
                className="text-sm leading-6 hover:text-white"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ADDRESS)}`}
                target="_blank"
                rel="noreferrer"
              >
                {LOCATION.street}
                <br />
                {LOCATION.unit} {LOCATION.building}
                <br />
                {LOCATION.postal}
              </a>
            </div>
          </div>
          <div className="flex gap-4">
            <Icon name="phone" />
            <div>
              <h2 className="mb-3 font-sans text-sm font-bold not-italic tracking-normal text-white">
                Contact Us
              </h2>
              <a
                className="block text-sm leading-7 hover:text-white"
                href={`tel:${CONTACT.phone}`}
              >
                {CONTACT.phoneDisplay}
              </a>
              <a
                className="block break-all text-sm leading-7 hover:text-white"
                href={`mailto:${CONTACT.email}`}
              >
                {CONTACT.email}
              </a>
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-4 border-t border-white/10 px-6 py-6 text-xs sm:px-10">
          <span>© 2026 SOCCERBOTSTUDIO Singapore. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/enquiry/">Get in touch</Link>
            <a href={CONTACT.instagram} target="_blank" rel="noreferrer">
              Instagram
            </a>
            <button onClick={() => setDialog("disclaimer")}>Disclaimer</button>
          </div>
        </div>
      </footer>
      <Assistant />
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
              <div className="flex flex-wrap gap-3">
                <button
                  className="button secondary"
                  onClick={() => setDialog(null)}
                >
                  Keep booking
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setDialog(null);
                    router.push("/");
                  }}
                >
                  Back to home
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
