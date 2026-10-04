"use client";
import Link from "next/link";
import { useRef, type PointerEvent } from "react";
import { studioMedia } from "@/content/media";
import { LOCATION } from "@/domain/catalog";
import { Icon } from "./icon";
import { ArenaFacility } from "./arena-facility";
import { entryPath, PITCH_STROKES } from "./arena-geometry";
import { useBookingNavigation } from "./booking-navigation";
export function Arena() {
  const { entering, enter } = useBookingNavigation(),
    area = useRef<HTMLAnchorElement>(null);
  function reset() {
    for (const name of ["--look-x", "--look-y", "--light-x", "--light-y"])
      area.current?.style.removeProperty(name);
  }
  function move(event: PointerEvent<HTMLAnchorElement>) {
    if (
      entering ||
      event.pointerType === "touch" ||
      window.matchMedia(
        "(prefers-reduced-motion: reduce), (max-width:1024px), (hover:none), (pointer:coarse), (any-pointer:coarse)",
      ).matches
    )
      return;
    const node = event.currentTarget,
      rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / rect.width),
      ),
      y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    node.style.setProperty("--look-x", `${(x - 0.5) * 18}px`);
    node.style.setProperty("--look-y", `${(y - 0.5) * 12}px`);
    node.style.setProperty("--light-x", `${x * 100}%`);
    node.style.setProperty("--light-y", `${y * 100}%`);
  }
  return (
    <section className="booking-stage" aria-labelledby="arena-heading">
      <p className="arena-signature">Performance · Experience · Production</p>
      <Link
        ref={area}
        className="arena-booking"
        href="/book/account/"
        data-entering={entering ? "true" : undefined}
        aria-label="Book now — choose your SOCCERBOTSTUDIO Singapore session"
        aria-describedby="arena-booking-cue"
        onPointerMove={move}
        onPointerLeave={reset}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          enter("/book/account/", event.currentTarget);
          reset();
        }}
      >
        <h1 id="arena-heading" className="sr-only">
          Your next session starts here.
        </h1>
        <div className="arena-atmosphere" aria-hidden="true" />
        <div className="arena-photograph" aria-hidden="true">
          <img
            src={studioMedia[0].src}
            width={2560}
            height={1707}
            alt=""
            fetchPriority="high"
            decoding="async"
          />
        </div>
        <div className="arena-scene" aria-hidden="true">
          <ArenaFacility />
          <svg
            className="arena-drawing"
            viewBox="0 0 1000 700"
            preserveAspectRatio="xMidYMid slice"
            focusable="false"
          >
            <g
              className="arena-pitch"
              fill="none"
              stroke="#79c4db"
              strokeWidth="1"
            >
              <g transform="translate(377 171)">
                <path
                  d={PITCH_STROKES.map((line) => entryPath(line)).join("")}
                />
              </g>
            </g>
            {[
              [473, 55, 54, ""],
              [482, 103, 36, "reverse"],
              [478, 563, 44, "inner"],
            ].map(([x, y, size, variant], index) => (
              <g key={index} className={`arena-ball-orbit ${variant}`}>
                <svg
                  className="arena-ball"
                  x={x}
                  y={y}
                  width={size}
                  height={size}
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m12 7 5 4-2 6H9l-2-6 5-4ZM12 2v5m10 3-5 1m1 9-3-3m-9 3 3-3M2 10l5 1" />
                </svg>
              </g>
            ))}
          </svg>
        </div>
        <div className="arena-topline" aria-hidden="true">
          <span className="arena-location">
            <Icon name="location" />
            <span>
              <strong>
                {LOCATION.building} · {LOCATION.unit}
              </strong>
              <small>
                {LOCATION.street} · {LOCATION.postal}
              </small>
            </span>
          </span>
        </div>
        <div className="arena-center" aria-hidden="true">
          <div className="arena-words">
            <div className="arena-idle">
              <span>Your</span>
              <span>Move.</span>
            </div>
            <div className="arena-reveal">
              <span>Book</span>
              <span>now.</span>
            </div>
          </div>
        </div>
        <div className="arena-bottomline">
          <div className="arena-cue">
            <strong id="arena-booking-cue">Book your next session</strong>
          </div>
          <span className="arena-entry-arrow" aria-hidden="true">
            <Icon name="arrow" />
          </span>
        </div>
      </Link>
    </section>
  );
}
