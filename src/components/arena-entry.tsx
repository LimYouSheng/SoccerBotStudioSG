"use client";
import { useCallback, useEffect, useState } from "react";
import {
  entryFrame,
  PITCH_TOTAL_MS,
  type EntryOrigin,
  type Viewport,
} from "./arena-geometry";
function pathStyle(id: string): React.SVGProps<SVGPathElement> {
  if (id.includes("brand")) return { fill: "#b5e6eb", fillRule: "evenodd" };
  if (id === "field") return { fill: "url(#entry-turf)" };
  if (id === "sweep-wash") return { fill: "#a9eeed" };
  if (id === "rear-panel" || /^panel-[-\d]/.test(id))
    return { fill: "url(#entry-panel)", stroke: "#7ca9bb", strokeWidth: 1 };
  if (id.startsWith("targets"))
    return {
      fill: "none",
      stroke: id.endsWith("red")
        ? "#df7977"
        : id.endsWith("mint")
          ? "#9bcfb0"
          : "#56c8bd",
      strokeWidth: 2.4,
      vectorEffect: "non-scaling-stroke",
      shapeRendering: "geometricPrecision",
      strokeLinecap: "round",
    };
  const style: Record<string, [string, number]> = {
    "sky-grid": ["#88bccb", 0.8],
    "rear-grid": ["#85b7c6", 0.8],
    "rear-rail": ["#a4dbe1", 1.3],
    floor: ["#658b9f", 0.8],
    markings: ["#99d6db", 1.3],
    rails: ["#a4dbe1", 1.3],
    sweep: ["#baf3ec", 2],
    net: ["#bddde4", 0.7],
    goal: ["#e3f6f5", 2.4],
  };
  const [stroke, strokeWidth] = style[id] || ["#85b7c6", 0.8];
  return { fill: "none", stroke, strokeWidth };
}
export function ArenaEntry({
  origin,
  viewport,
  started,
  revealing,
  finish,
}: {
  origin: EntryOrigin;
  viewport: Viewport;
  started: number;
  revealing: boolean;
  finish: () => void;
}) {
  const focusEntry = useCallback(
    (node: HTMLButtonElement | null) => node?.focus({ preventScroll: true }),
    [],
  );
  const [frame, setFrame] = useState(() => entryFrame(0, origin, viewport));
  useEffect(() => {
    let animation = 0;
    function draw(now: number) {
      setFrame(entryFrame((now - started) / PITCH_TOTAL_MS, origin, viewport));
      if (now - started < PITCH_TOTAL_MS)
        animation = requestAnimationFrame(draw);
    }
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, [origin, viewport, started]);
  const order = [
    "sky-grid",
    "rear-panel",
    "rear-grid",
    "rear-brand",
    "rear-rail",
    "floor",
    "field",
    "markings",
    "pitch-brand",
    ...[-1, 1].flatMap((side) =>
      [5, 4, 3, 2, 1, 0].flatMap((i) => [
        `panel-${side}-${i}`,
        `panel-grid-${side}-${i}`,
        ...(i % 2 ? [`panel-brand-${side}-${i}`] : []),
      ]),
    ),
    "rails",
    "targets",
    "targets-mint",
    "targets-red",
    "sweep-wash",
    "sweep",
    "net",
    "goal",
  ];
  return (
    <button
      type="button"
      className="pitch-entry"
      data-phase={revealing ? "revealing" : "entering"}
      aria-label="Skip arena transition"
      ref={focusEntry}
      onClick={finish}
      onKeyDown={(event) => {
        if (event.key === "Escape") finish();
      }}
    >
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="entry-room">
            <stop stopColor="#203f43" />
            <stop offset=".5" stopColor="#112337" />
            <stop offset="1" stopColor="#070e29" />
          </radialGradient>
          <linearGradient id="entry-panel" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#526477" />
            <stop offset=".55" stopColor="#2b4555" />
            <stop offset="1" stopColor="#142c3c" />
          </linearGradient>
          <linearGradient id="entry-turf" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#204f3f" />
            <stop offset="1" stopColor="#112e33" />
          </linearGradient>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="url(#entry-room)"
          opacity={frame.background}
        />
        {order.map((id) => (
          <path
            key={id}
            data-scene-part={id}
            {...frame.paths[id]}
            {...pathStyle(id)}
          />
        ))}
      </svg>
    </button>
  );
}
