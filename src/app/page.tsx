import Link from "next/link";
import { Arena } from "@/components/arena";
import { BookingLink } from "@/components/booking-navigation";
import { Icon } from "@/components/icon";
import { homeMedia } from "@/content/media";
import { SERVICE_NAME } from "@/domain/demo-catalog";
export default function Home() {
  return (
    <>
      <Arena />
      <div className="experience-strip">
        <div className="strip-inner">
          <span>
            <Icon name="clock" />
            40-minute sessions
          </span>
          <span>
            <Icon name="users" />
            Up to 4 players
          </span>
        </div>
      </div>
      <section className="home-studio" aria-labelledby="home-studio-title">
        <div className="home-studio-inner">
          <figure className="home-studio-photo">
            <img
              src={homeMedia.studio.src}
              alt={homeMedia.studio.alt}
              width={homeMedia.studio.width}
              height={homeMedia.studio.height}
              loading="lazy"
              decoding="async"
            />
          </figure>
          <div className="home-studio-copy">
            <h2 id="home-studio-title">Inside the studio</h2>
            <p>
              Interactive projections surround the turf, bringing targets and
              football scenarios into the arena. Every session includes full
              instructor guidance for your group.
            </p>
            <BookingLink className="button" href="/studio/">
              Explore the studio <Icon name="arrow" />
            </BookingLink>
            <small className="home-image-credit">
              Imagery:{" "}
              <a
                href="https://soccerbot360.com/en"
                target="_blank"
                rel="noreferrer"
              >
                SOCCERBOT360 global studios
              </a>
              .
            </small>
          </div>
        </div>
      </section>
      <section className="home-section" id="sessions">
        <div className="section-head">
          <div>
            <h2>Book a session</h2>
            <p>Full instructor guidance included.</p>
          </div>
        </div>
        <div className="home-offers">
          <BookingLink
            href="/book/account/"
            className="offer-home"
            aria-labelledby="offer-title"
            aria-describedby="offer-description"
          >
            <span
              className="offer-art"
              style={
                {
                  "--offer-zoom": homeMedia.kickoff.zoom,
                } as React.CSSProperties
              }
              aria-hidden="true"
            >
              <img
                src={homeMedia.kickoff.src}
                alt=""
                width={homeMedia.kickoff.width}
                height={homeMedia.kickoff.height}
                loading="lazy"
                decoding="async"
              />
            </span>
            <span className="offer-home-copy">
              <span className="offer-title" id="offer-title">
                {SERVICE_NAME}
              </span>
              <span className="offer-description" id="offer-description">
                A 40-minute studio session for up to four players. Explore
                Single, Team and Battle play in the immersive arena, with an
                instructor guiding your group throughout.
              </span>
              <span className="offer-meta">
                <span>40 minutes · 1–4 players</span>
                <strong>S$88.00 / session</strong>
              </span>
            </span>
          </BookingLink>
        </div>
      </section>
      <Link href="/enquiry/" className="contact-banner">
        <span className="contact-banner-copy">
          <span className="contact-banner-title">Contact us</span>
          <span className="contact-banner-description">
            For Multi-Session Bundles, Membership, Academy, Corporate and
            Sponsorship Rates
          </span>
        </span>
        <span className="contact-banner-arrow">
          <Icon name="arrow" />
        </span>
      </Link>
    </>
  );
}
