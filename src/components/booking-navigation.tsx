"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ArenaEntry } from "./arena-entry";
import { BrandLoading } from "./brand-loading";
import {
  measurePitchOrigin,
  PITCH_ENTER_MS,
  PITCH_REVEAL_MS,
  type EntryOrigin,
  type Viewport,
} from "./arena-geometry";
type Entry = {
  kind: "logo" | "arena";
  from: string;
  to: string;
  started: number;
  origin?: EntryOrigin;
  viewport?: Viewport;
  skip?: boolean;
};
const Navigation = createContext<{
  entering: boolean;
  enter: (href: string, arena?: HTMLElement) => void;
} | null>(null);
export function useBookingNavigation() {
  const context = useContext(Navigation);
  if (!context) throw new Error("Booking navigation provider missing");
  return context;
}
export function BookingNavigation({ children }: { children: ReactNode }) {
  const router = useRouter(),
    pathname = usePathname();
  const [entry, setEntry] = useState<Entry | null>(null),
    [leaving, setLeaving] = useState(false);
  const active = useRef(false),
    committed = useRef(false);
  const arrived = !!entry && pathname !== entry.from;
  function enter(to: string, arena?: HTMLElement) {
    if (active.current) return;
    if (
      pathname === to ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      router.push(to);
      return;
    }
    active.current = true;
    committed.current = !arena;
    setLeaving(false);
    setEntry({
      kind: arena ? "arena" : "logo",
      from: pathname,
      to,
      started: performance.now(),
      ...(arena
        ? {
            origin: measurePitchOrigin(arena),
            viewport: { width: window.innerWidth, height: window.innerHeight },
          }
        : {}),
    });
    if (!arena) router.push(to);
  }
  function finish() {
    if (!entry) return;
    if (!committed.current) {
      committed.current = true;
      router.push(entry.to);
    }
    if (arrived) {
      setEntry(null);
      active.current = false;
    } else setEntry({ ...entry, skip: true });
  }
  useEffect(() => {
    if (!entry) return;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const cancel = () => {
      setEntry(null);
      active.current = false;
    };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => {
      if (motion.matches) {
        if (!committed.current) {
          committed.current = true;
          router.push(entry.to);
        }
        cancel();
      }
    };
    motion.addEventListener("change", reduce);
    window.addEventListener("popstate", cancel);
    const watchdog = setTimeout(cancel, 15000);
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      clearTimeout(watchdog);
      motion.removeEventListener("change", reduce);
      window.removeEventListener("popstate", cancel);
    };
  }, [entry, router]);
  useEffect(() => {
    if (!entry || entry.kind !== "arena" || committed.current) return;
    const timer = setTimeout(
      () => {
        committed.current = true;
        router.push(entry.to);
      },
      Math.max(0, PITCH_ENTER_MS - (performance.now() - entry.started)),
    );
    return () => clearTimeout(timer);
  }, [entry, router]);
  useEffect(() => {
    if (!entry || !arrived) return;
    const delay = entry.skip
      ? 0
      : entry.kind === "arena"
        ? PITCH_REVEAL_MS
        : Math.max(0, 480 - (performance.now() - entry.started));
    let fade: ReturnType<typeof setTimeout> | undefined;
    const complete = () => {
      setEntry(null);
      active.current = false;
      document.getElementById("main")?.focus({ preventScroll: true });
    };
    const timer = setTimeout(() => {
      if (entry.kind === "logo" && !entry.skip) {
        setLeaving(true);
        fade = setTimeout(complete, 180);
      } else complete();
    }, delay);
    return () => {
      clearTimeout(timer);
      clearTimeout(fade);
    };
  }, [entry, arrived]);
  return (
    <Navigation.Provider
      value={{ entering: entry?.kind === "arena" && !arrived, enter }}
    >
      <div
        inert={!!entry}
        aria-busy={entry ? true : undefined}
        data-booking-reveal={
          entry?.kind === "arena" && arrived && !entry.skip ? "true" : undefined
        }
      >
        {children}
      </div>
      {entry?.kind === "logo" && (
        <BrandLoading
          leaving={leaving}
          label={entry.to === "/studio/" ? "Opening studio" : "Opening booking"}
        />
      )}
      {entry?.kind === "arena" && entry.origin && entry.viewport && (
        <ArenaEntry
          origin={entry.origin}
          viewport={entry.viewport}
          started={entry.started}
          revealing={arrived}
          finish={finish}
        />
      )}
    </Navigation.Provider>
  );
}
export function BookingLink({
  onClick,
  ...props
}: ComponentProps<typeof Link>) {
  const { enter } = useBookingNavigation();
  return (
    <Link
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target === "_blank"
        )
          return;
        if (typeof props.href === "string") {
          event.preventDefault();
          enter(props.href);
        }
      }}
    />
  );
}
