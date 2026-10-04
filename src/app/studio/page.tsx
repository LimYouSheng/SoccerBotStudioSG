import { BookingLink } from "@/components/booking-navigation";
import { studioMedia } from "@/content/media";
import { Icon } from "@/components/icon";
export const metadata = { title: "The studio" };
export default function Studio() {
  return (
    <section className="studio-showcase" aria-labelledby="studio-title">
      <h1 className="sr-only" id="studio-title">
        SOCCERBOTSTUDIO Singapore
      </h1>
      <p className="studio-signature">Performance · Experience · Production</p>
      {studioMedia.map((photo, index) => (
        <section
          key={photo.src}
          className={`studio-row${index % 2 ? " reverse" : ""}`}
          aria-labelledby={`studio-section-${index + 1}`}
        >
          <div className="studio-copy">
            <h2 id={`studio-section-${index + 1}`}>{photo.title}</h2>
            <p className="studio-description">{photo.description}</p>
          </div>
          <figure
            className="studio-photo"
            style={{ "--photo-zoom": photo.zoom || 1 } as React.CSSProperties}
          >
            <img
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading={index ? "lazy" : "eager"}
              fetchPriority={index ? undefined : "high"}
              decoding="async"
            />
          </figure>
        </section>
      ))}
      <div className="studio-bottom">
        <BookingLink className="button" href="/book/account/">
          <span className="studio-book-content">
            <span>Book now</span>
            <span className="studio-book-arrow" aria-hidden="true">
              <Icon name="arrow" />
            </span>
          </span>
        </BookingLink>
        <p className="studio-credit">
          Global studio imagery and technology:{" "}
          <a
            href="https://soccerbot360.com/en/produkt"
            target="_blank"
            rel="noreferrer"
          >
            official product information
          </a>
          .
        </p>
      </div>
    </section>
  );
}
