"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { studioMedia } from "@/content/media";
import { LOCATION } from "@/domain/catalog";
import { Icon } from "./icon";
export function Arena() {
  const [entering, setEntering] = useState(false),
    router = useRouter();
  useEffect(() => {
    if (!entering) return;
    const timer = setTimeout(() => router.push("/book/account/"), 2800);
    return () => clearTimeout(timer);
  }, [entering, router]);
  return (
    <section className="bg-navy text-white" aria-labelledby="arena-heading">
      <p className="border-y border-[#26374f] py-4 text-center text-xs tracking-[.23em] text-[#b5ccd8] uppercase">
        Performance · Experience · Production
      </p>
      <Link
        className="arena"
        href="/book/account/"
        aria-label="Book now — choose your SOCCERBOTSTUDIO Singapore session"
        onClick={(event) => {
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
          )
            return;
          event.preventDefault();
          setEntering(true);
        }}
      >
        <h1 id="arena-heading" className="sr-only">
          Your next session starts here.
        </h1>
        <img
          src={studioMedia[0].src}
          width={2560}
          height={1707}
          alt=""
          fetchPriority="high"
          className="arena-photo"
        />
        <svg
          className="pointer-events-none absolute inset-0 -z-1 h-full w-full opacity-50"
          viewBox="0 0 1000 700"
          fill="none"
          stroke="#93dfeb"
          aria-hidden="true"
        >
          <ellipse cx="500" cy="350" rx="360" ry="170" opacity=".12" />
          <ellipse cx="500" cy="350" rx="160" ry="90" opacity=".15" />
          {[0, 1, 2].map((index) => (
            <g
              key={index}
              className={`arena-orbit ${index === 1 ? "reverse" : index === 2 ? "inner" : ""}`}
            >
              <circle
                cx="500"
                cy={80 + index * 50}
                r={18 - index * 3}
                fill="#091637"
              />
              <path d={`m500 ${70 + index * 50} 9 6-3 10h-12l-3-10Z`} />
            </g>
          ))}
        </svg>
        <div className="flex items-start gap-3 text-[#bec9e2]">
          <Icon name="location" />
          <div className="text-xs leading-6">
            <strong className="block font-medium">
              {LOCATION.building} · {LOCATION.unit}
            </strong>
            <small>
              {LOCATION.street} · {LOCATION.postal}
            </small>
          </div>
        </div>
        <div className="arena-words" aria-hidden="true">
          <div className="arena-idle">
            <span>Your</span>
            <span>Move.</span>
          </div>
          <div className="arena-reveal">
            <span>Book</span>
            <span>now.</span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[#8bb6da2b] pt-5">
          <span className="text-sm">Book your next session</span>
          <span className="grid h-13 w-13 place-items-center rounded-full border border-[#9bc4df70] bg-cyan/10">
            <Icon name="arrow" />
          </span>
        </div>
      </Link>
      {entering && (
        <button
          className="arena-entry"
          aria-label="Skip arena transition"
          onClick={() => {
            router.push("/book/account/");
            setEntering(false);
          }}
        >
          <svg
            viewBox="0 0 900 600"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <ellipse cx="450" cy="300" rx="370" ry="235" />
            <ellipse cx="450" cy="300" rx="325" ry="200" />
            <path d="M450 100v400M125 300h650" />
            <circle cx="450" cy="300" r="85" />
            <path d="m450 255 44 32-17 50h-54l-17-50Z" />
          </svg>
        </button>
      )}
    </section>
  );
}
