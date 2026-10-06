import { darkLogo } from "@/content/media";
export function BrandLoading({
  leaving = false,
  overlay = true,
  label = "Opening booking",
}: {
  leaving?: boolean;
  overlay?: boolean;
  label?: string;
}) {
  return (
    <div
      className={overlay ? "page-loading" : "booking-loading"}
      data-phase={leaving ? "leaving" : "loading"}
      role="status"
      aria-label={label}
    >
      <div className="page-loading-content">
        <svg
          className="page-loading-emblem"
          viewBox="0 0 120 120"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="60" cy="60" r="51" stroke="#dce5ec" strokeWidth="1" />
          <circle className="page-loading-orbit" cx="60" cy="60" r="43" />
          <g transform="translate(36 36) scale(2)">
            <circle cx="12" cy="12" r="9" />
            <path d="m12 7 5 4-2 6H9l-2-6zM12 7V3M17 11l4-1M15 17l2 3M9 17l-2 3M7 11l-4-1" />
          </g>
        </svg>
        <img
          src={darkLogo}
          width={565}
          height={190}
          className="official-logo loading-logo"
          alt="SOCCERBOTSTUDIO Singapore"
        />
        <div className="page-loading-track" aria-hidden="true" />
      </div>
    </div>
  );
}
