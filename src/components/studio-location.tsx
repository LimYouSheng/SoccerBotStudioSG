"use client";
import { useState } from "react";
import { ADDRESS, LOCATION } from "@/domain/catalog";
import { Dialog } from "./dialog";
import { Icon } from "./icon";
const mapQuery = encodeURIComponent(
  `${LOCATION.building}, ${LOCATION.street}, ${LOCATION.postal}`,
);
export function StudioLocation() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="arena-location studio-location-trigger"
        aria-label="View studio location"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="location" />
        <span>
          <strong>
            {LOCATION.building} · {LOCATION.unit}
          </strong>
          <small>
            {LOCATION.street} · {LOCATION.postal}
          </small>
        </span>
      </button>
      {open && (
        <Dialog title="Find the studio" onClose={() => setOpen(false)}>
          <p className="studio-location-address">{ADDRESS}</p>
          <div className="studio-map-frame">
            <iframe
              title="Satellite map of Apex at Henderson and surrounding roads"
              src={`https://www.google.com/maps?q=${mapQuery}&t=k&z=18&output=embed`}
              referrerPolicy="no-referrer"
              allowFullScreen
            />
          </div>
          <p className="studio-map-help">
            Find us on level 5, unit 01. Open Google Maps to explore
            street-level and available 3D views, or get directions.
          </p>
          <a
            className="button wide"
            href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
            target="_blank"
            rel="noreferrer"
          >
            Open Google Maps <Icon name="arrow" />
          </a>
        </Dialog>
      )}
    </>
  );
}
