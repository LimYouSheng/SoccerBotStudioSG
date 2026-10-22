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
  generation: number;
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
/** Read the shared booking navigation context. */
export function useBookingNavigation() {
  const context = useContext(Navigation);
  if (!context) throw new Error("Booking navigation provider missing");
  return context;
}
/** Coordinate booking navigation with the current draft and route. */
export function BookingNavigation({ children }: { children: ReactNode }) {
  const router = useRouter(),
    pathname = usePathname();
  const [entry, setEntry] = useState<Entry | null>(null),
    [leaving, setLeaving] = useState(false);
  const generation = useRef(0);
  const active = useRef(false),
    committed = useRef(false);
  const arrived = !!entry && pathname !== entry.from;
  /** Enter the booking flow while respecting retained attempt state. */
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
    const id = ++generation.current;
    if (arena) {
      // Back must cancel this transition on its origin page, not jump to the
      // page visited before it. The eventual destination replaces this entry.
      window.history.pushState(
        { ...window.history.state, soccerbotArena: id },
        "",
        window.location.href,
      );
    }
    committed.current = !arena;
    setLeaving(false);
    setEntry({
      generation: id,
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
    if (!entry || entry.generation !== generation.current || !active.current)
      return;
    if (!committed.current) {
      committed.current = true;
      router.replace(entry.to);
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
      generation.current++;
      setEntry(null);
      active.current = false;
    };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => {
      if (motion.matches) {
        if (!committed.current) {
          committed.current = true;
          router.replace(entry.to);
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
        if (!active.current || entry.generation !== generation.current) return;
        committed.current = true;
        router.replace(entry.to);
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
/** Navigate through the shared booking entry controls. */
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
