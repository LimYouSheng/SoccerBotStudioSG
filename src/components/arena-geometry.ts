// Geometry ported from showcase(2).html. React owns the scene lifecycle and SVG rendering.
import { ENTRY_LOGO_CONTOURS } from "@/content/arena-logo";
type Point = number[];
type Matrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};
export type Viewport = { width: number; height: number };
export type EntryOrigin = {
  x: number;
  y: number;
  scale: number;
  angle: number;
  opacity: number;
  matrix?: Matrix;
  facility: Matrix;
  curveCache?: Map<string, Point>;
};
export type EntryFrame = Viewport & {
  background: number;
  paths: Record<string, { d: string; opacity?: number }>;
};
export const PITCH_ENTER_MS = 3000;
export const PITCH_REVEAL_MS = 900;
export const PITCH_TOTAL_MS = PITCH_ENTER_MS + PITCH_REVEAL_MS;
const entryClamp = (n: number) => Math.max(0, Math.min(1, n));
const entryEase = (a: number, b: number, t: number) => {
  const u = entryClamp((t - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const entryMix = (a: number, b: number, t: number) => a + (b - a) * t;
const entryPoint = (a: Point, b: Point, t: number) =>
  a.map((v, i) => entryMix(v, b[i], t));
export const entryPath = (points: Point[], closed = false) =>
  points
    .map((p, i) => (i ? "L" : "M") + p.map((v) => v.toFixed(2)).join(" "))
    .join("") + (closed ? "Z" : "");
export const FACILITY_EDGES = [
  [-100, 70, 622],
  [65, 103, 601],
  [205, 164, 562],
  [325, 231, 510],
  [425, 270, 463],
  [505, 290, 430],
  [567, 302, 408],
];
export const PITCH_STROKES = (() => {
  const lines = [
    [
      [0, 179],
      [246, 179],
    ],
    [
      [48, 0],
      [48, 65],
      [198, 65],
      [198, 0],
    ],
    [
      [48, 358],
      [48, 293],
      [198, 293],
      [198, 358],
    ],
    [
      [85, 0],
      [85, 24],
      [161, 24],
      [161, 0],
    ],
    [
      [85, 358],
      [85, 334],
      [161, 334],
      [161, 358],
    ],
  ];
  const circle = (x: number, y: number, r: number) =>
    Array.from({ length: 65 }, (_, i) => [
      x + r * Math.cos((i * Math.PI) / 32),
      y + r * Math.sin((i * Math.PI) / 32),
    ]);
  const boundary = [];
  for (const [x, y, start] of [
    [240, 6, -Math.PI / 2],
    [240, 352, 0],
    [6, 352, Math.PI / 2],
    [6, 6, Math.PI],
  ])
    for (let i = 0; i <= 8; i++) {
      const a = start + (i * Math.PI) / 16;
      boundary.push([x + 6 * Math.cos(a), y + 6 * Math.sin(a)]);
    }
  boundary.push(boundary[0]);
  lines.unshift(boundary);
  lines.push(circle(123, 179, 46), circle(123, 179, 2));
  for (const [y, sign] of [
    [65, 1],
    [293, -1],
  ])
    lines.push(
      Array.from({ length: 25 }, (_, i) => {
        const t = i / 24;
        return [
          106 + 34 * t,
          y +
            sign *
              (Math.sqrt(26 * 26 - (34 * t - 17) ** 2) -
                Math.sqrt(26 * 26 - 17 * 17)),
        ];
      }),
    );
  return lines;
})();
export function measurePitchOrigin(area: HTMLElement): EntryOrigin {
  const rect = area.getBoundingClientRect(),
    pitch = area.querySelector<SVGGElement>(".arena-pitch"),
    matrix = pitch?.getScreenCTM?.();
  const revealed =
    window.matchMedia(
      "(max-width:1024px), (hover:none), (pointer:coarse), (any-pointer:coarse)",
    ).matches || area.matches?.(":hover, :focus-visible");
  const origin: EntryOrigin = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    scale:
      (246 *
        Math.max(rect.width / 1000, rect.height / 700) *
        (revealed ? 1.16 : 0.98)) /
      680,
    angle: revealed ? 0 : -16,
    opacity: revealed ? 0.1 : 0.04,
    facility: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  };
  if (
    matrix &&
    [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
      Number.isFinite,
    )
  ) {
    origin.matrix = {
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      e: matrix.e,
      f: matrix.f,
    };
    origin.x = matrix.a * 500 + matrix.c * 350 + matrix.e;
    origin.y = matrix.b * 500 + matrix.d * 350 + matrix.f;
    origin.scale = (246 * Math.hypot(matrix.a, matrix.b)) / 680;
    origin.angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  }
  const facility = area.querySelector<SVGSVGElement>(".arena-facility"),
    fm = facility?.getScreenCTM?.();
  origin.facility =
    fm && [fm.a, fm.b, fm.c, fm.d, fm.e, fm.f].every(Number.isFinite)
      ? { a: fm.a, b: fm.b, c: fm.c, d: fm.d, e: fm.e, f: fm.f }
      : {
          a: rect.width / 1600,
          b: 0,
          c: 0,
          d: rect.height / 700,
          e: rect.left,
          f: rect.top,
        };
  if (pitch && typeof getComputedStyle === "function")
    origin.opacity = Number(getComputedStyle(pitch).opacity) || origin.opacity;
  return origin;
}
const entryLogoPath = (project: (point: Point) => Point) =>
  ENTRY_LOGO_CONTOURS.map((contour) =>
    entryPath(contour.map(project), true),
  ).join("");
export function entryTargetArc(
  [cx, cy]: Point,
  radius: number,
  start = 0,
  end = Math.PI * 2,
) {
  const point = (a: number) =>
    [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]
      .map((n) => n.toFixed(3))
      .join(" ");
  const r = radius.toFixed(3),
    sweep = end - start;
  if (sweep >= Math.PI * 2 - 0.00001)
    return `M${point(start)}A${r} ${r} 0 1 1 ${point(start + Math.PI)}A${r} ${r} 0 1 1 ${point(start)}Z`;
  return `M${point(start)}A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(end)}`;
}
export function entryFrame(
  progress: number,
  origin: EntryOrigin,
  viewport: Viewport,
): EntryFrame {
  const halfWidth = 4,
    near = -2,
    far = 12,
    wallHeight = 3.45;
  const t = entryClamp(progress),
    w = viewport.width,
    h = viewport.height,
    morph = entryEase(0, 0.56, t),
    travel = entryEase(0, 1, t),
    light = entryEase(0.08, 0.64, t);
  const focal = Math.min(w * 0.88, h * 1.15),
    camera = entryMix(-6.8, -0.5, travel),
    eye = entryMix(3.3, 2.2, travel),
    horizon = entryMix(h * 0.3, h * 0.36, travel);
  const roundness = entryEase(0.24, 0.72, t),
    curveCache = origin.curveCache || (origin.curveCache = new Map());
  const projectFlat = ([x, y, z]: Point) => {
    const depth = Math.max(0.6, z - camera);
    return [w / 2 + (x * focal) / depth, horizon + ((eye - y) * focal) / depth];
  };
  // A square-to-disc mapping gives every wall and turf edge the same circular footprint.
  const project = ([x, y, z]: Point) => {
    if (roundness > 0) {
      const key = x + "," + z;
      let curved = curveCache.get(key);
      if (!curved) {
        const u = Math.max(-1, Math.min(1, x / halfWidth)),
          v = Math.max(-1, Math.min(1, (z - 5) / 7));
        curved = [
          6.5 * u * Math.sqrt(1 - (v * v) / 2),
          5.5 + 6.5 * v * Math.sqrt(1 - (u * u) / 2),
        ];
        if (curveCache.size < 12000) curveCache.set(key, curved);
      }
      x += (curved[0] - x) * roundness;
      z += (curved[1] - z) * roundness;
    }
    const depth = Math.max(0.6, z - camera);
    return [w / 2 + (x * focal) / depth, horizon + ((eye - y) * focal) / depth];
  };
  const sample = (fn: (u: number) => Point, count = 16) =>
    Array.from({ length: count + 1 }, (_, i) => fn(i / count));
  const trace = (
    points: Point[],
    projector: (point: Point) => Point,
    count = 12,
  ) =>
    points
      .slice(1)
      .flatMap((end, i) =>
        sample((u) => projector(entryPoint(points[i], end, u)), count),
      );
  const transform = (m: Matrix, x: number, y: number) => [
    m.a * x + m.c * y + m.e,
    m.b * x + m.d * y + m.f,
  ];
  const sourcePoint = ([u, v]: Point) => {
    if (origin.matrix) return transform(origin.matrix, 377 + u, 171 + v);
    const angle = (origin.angle * Math.PI) / 180,
      k = (origin.scale * 680) / 246,
      x = (u - 123) * k,
      y = (v - 179) * k;
    return [
      origin.x + x * Math.cos(angle) - y * Math.sin(angle),
      origin.y + x * Math.sin(angle) + y * Math.cos(angle),
    ];
  };
  const fieldPoint = (uv: Point) =>
    entryPoint(
      sourcePoint(uv),
      project([
        (uv[0] / 246 - 0.5) * halfWidth * 2,
        0,
        far - (uv[1] / 358) * (far - near),
      ]),
      morph,
    );
  const paths: EntryFrame["paths"] = {};
  const add = (
    id: string,
    points: string | Point[],
    attributes: { opacity?: number } = {},
  ) => {
    paths[id] = {
      d: typeof points === "string" ? points : entryPath(points),
      ...attributes,
    };
  };
  add(
    "field",
    entryPath(
      trace(
        [
          [0, 0],
          [246, 0],
          [246, 358],
          [0, 358],
          [0, 0],
        ],
        fieldPoint,
        24,
      ),
      true,
    ),
    { opacity: entryEase(0.01, 0.4, t) * 0.86 },
  );
  add(
    "markings",
    PITCH_STROKES.map((line) =>
      entryPath(trace(line, fieldPoint, line.length > 20 ? 1 : 12)),
    ).join(""),
    { opacity: entryMix(origin.opacity, 0.8, light) },
  );
  // A projected centre-circle mark travels with the original pitch morph.
  add(
    "pitch-brand",
    entryLogoPath(([u, v]) => fieldPoint([78 + u * 90, 182 + v * 25])),
    { opacity: entryEase(0.18, 0.58, t) * 0.32 },
  );
  // The ceiling follows the same curved perimeter while the surrounding ground stays gridded.
  const sky = [];
  for (let x = -halfWidth; x <= halfWidth; x += 0.5)
    sky.push(
      entryPath(
        sample((u) => project([x, wallHeight, entryMix(near, far, u)]), 32),
      ),
    );
  for (let i = 0; i <= 12; i++) {
    const z = near + (i * (far - near)) / 12;
    sky.push(
      entryPath(
        sample(
          (u) => project([entryMix(-halfWidth, halfWidth, u), wallHeight, z]),
          32,
        ),
      ),
    );
  }
  add("sky-grid", sky.join(""), { opacity: entryEase(0.1, 0.56, t) * 0.28 });
  const floor = [];
  for (let x = -10; x <= 10; x++)
    floor.push([projectFlat([x, 0, camera + 0.65]), projectFlat([x, 0, 21])]);
  for (let z = camera + 0.65; z <= 21; z++)
    floor.push([projectFlat([-10, 0, z]), projectFlat([10, 0, z])]);
  add("floor", floor.map((line) => entryPath(line)).join(""), {
    opacity: entryEase(0.08, 0.42, t) * 0.24,
  });
  // The goal-end panel lowers into the far edge of the arena and joins the side panels.
  const rearLanding = entryEase(0.08, 0.6, t),
    rearBase = project([halfWidth, 0, far]);
  const rearOffset = -(rearBase[1] + 24) * (1 - rearLanding);
  const rearPoint = (point: Point) => {
    const result = project(point);
    result[1] += rearOffset;
    return result;
  };
  const rearTop = sample(
    (u) => rearPoint([entryMix(-halfWidth, halfWidth, u), wallHeight, far]),
    32,
  );
  const rearBottom = sample(
    (u) => rearPoint([entryMix(-halfWidth, halfWidth, u), 0, far]),
    32,
  );
  const rearOpacity =
    entryEase(0.04, 0.18, t) *
    (0.42 + Math.exp(-(((t - 0.61) / 0.11) ** 2)) * 0.12);
  add(
    "rear-panel",
    entryPath([...rearTop, ...rearBottom.slice().reverse()], true),
    { opacity: rearOpacity },
  );
  const rearGrid = [];
  for (const fraction of [-2 / 3, -1 / 3, 1 / 3, 2 / 3]) {
    const x = halfWidth * fraction;
    rearGrid.push(
      entryPath(
        [
          [x, 0, far],
          [x, wallHeight, far],
        ].map(rearPoint),
      ),
    );
  }
  for (const y of [wallHeight / 3, (wallHeight * 2) / 3])
    rearGrid.push(
      entryPath(
        sample(
          (u) => rearPoint([entryMix(-halfWidth, halfWidth, u), y, far]),
          32,
        ),
      ),
    );
  add("rear-grid", rearGrid.join(""), {
    opacity: entryEase(0.12, 0.42, t) * 0.18,
  });
  add("rear-rail", entryPath(rearTop), {
    opacity: entryEase(0.08, 0.4, t) * 0.58,
  });
  add(
    "rear-brand",
    entryLogoPath(([u, v]) =>
      rearPoint([-1.95 + u * 3.9, 3.34 - v * 1.31, far]),
    ),
    { opacity: entryEase(0.28, 0.62, t) * 0.36 },
  );
  const rails = [],
    targets: string[] = [],
    redTargets = [],
    mintTargets: string[] = [];
  const targetRadius = Math.min(w, h) * entryMix(0.012, 0.047, travel);
  for (const side of [-1, 1])
    for (let i = 0; i < 6; i++) {
      const [x, top, bottom] = FACILITY_EDGES[i],
        [nx, nt, nb] = FACILITY_EDGES[i + 1];
      const source = [
        [x, top],
        [nx, nt],
        [nx, nb],
        [x, bottom],
      ].map(([px, py]) =>
        transform(origin.facility, side < 0 ? px : 1600 - px, py),
      );
      const edge = (j: number) => [
        side * halfWidth,
        near + (j * (far - near)) / 6,
      ];
      const [ax, az] = edge(i),
        [bx, bz] = edge(i + 1),
        align = entryEase(i * 0.012, 0.48 + i * 0.012, t);
      const uv = (u: number, v: number) => {
        const to = project([
          ax + (bx - ax) * u,
          wallHeight * (1 - v),
          az + (bz - az) * u,
        ]);
        if (align === 1) return to;
        const a = (1 - u) * (1 - v),
          b = u * (1 - v),
          c = u * v,
          d = (1 - u) * v;
        const sx =
          source[0][0] * a +
          source[1][0] * b +
          source[2][0] * c +
          source[3][0] * d;
        const sy =
          source[0][1] * a +
          source[1][1] * b +
          source[2][1] * c +
          source[3][1] * d;
        return [sx + (to[0] - sx) * align, sy + (to[1] - sy) * align];
      };
      const topEdge = sample((u) => uv(u, 0)),
        bottomEdge = sample((u) => uv(u, 1));
      const pulse = Math.exp(-((t * 8 - i - 1.8) ** 2) / 0.9),
        opacity = entryMix(0.25 - i * 0.02, 0.48, light) + pulse * 0.22;
      add(
        "panel-" + side + "-" + i,
        entryPath([...topEdge, ...bottomEdge.slice().reverse()], true),
        { opacity },
      );
      const grid = [];
      for (const n of [1 / 3, 2 / 3])
        grid.push(entryPath([uv(n, 0), uv(n, 1)]));
      grid.push(entryPath(sample((u) => uv(u, 0.5))));
      add("panel-grid-" + side + "-" + i, grid.join(""), {
        opacity: entryEase(0.1, 0.48, t) * (0.16 + pulse * 0.23),
      });
      if (i % 2 === 1)
        add(
          "panel-brand-" + side + "-" + i,
          entryLogoPath(([u, v]) =>
            uv(side < 0 ? 0.08 + u * 0.84 : 0.92 - u * 0.84, 0.18 + v * 0.19),
          ),
          { opacity: entryEase(0.2, 0.58, t) * 0.3 },
        );
      rails.push(entryPath(topEdge), entryPath(bottomEdge));
      const ring = (start = 0, end = Math.PI * 2) =>
        entryTargetArc(uv(0.5, 0.6), targetRadius, start, end);
      const targetType = (i + (side > 0 ? 1 : 0)) % 3;
      (targetType === 0
        ? redTargets
        : targetType === 1
          ? targets
          : mintTargets
      ).push(ring());
      if (targetType !== 0)
        redTargets.push(ring(Math.PI * 0.15, Math.PI * 0.82));
    }
  // All targets share one radius and analytic SVG arcs, without perspective distortion.
  for (const side of [-1, 1]) {
    const ring = entryTargetArc(
      rearPoint([side * 2.8, 1.15, far]),
      targetRadius,
    );
    (side < 0 ? redTargets : mintTargets).push(ring);
  }
  add("rails", rails.join(""), { opacity: entryEase(0.02, 0.46, t) * 0.65 });
  const targetLight = entryEase(0.08, 0.46, t) * 0.76;
  add("targets", targets.join(""), { opacity: targetLight });
  add("targets-red", redTargets.join(""), { opacity: targetLight });
  add("targets-mint", mintTargets.join(""), { opacity: targetLight * 0.88 });
  // One restrained wave traces the turf and activates the surrounding panels.
  const sweep = entryEase(0.12, 0.73, t),
    z = entryMix(-2.4, 13, sweep),
    pulseOpacity = entryEase(0.12, 0.28, t) * (1 - entryEase(0.66, 0.77, t));
  add(
    "sweep",
    entryPath(
      sample((u) => project([entryMix(-halfWidth, halfWidth, u), 0, z]), 32),
    ),
    { opacity: pulseOpacity * 0.9 },
  );
  add(
    "sweep-wash",
    entryPath(
      [
        ...sample(
          (u) => project([entryMix(-halfWidth, halfWidth, u), 0, z - 0.5]),
          32,
        ),
        ...sample(
          (u) => project([entryMix(halfWidth, -halfWidth, u), 0, z]),
          32,
        ),
      ],
      true,
    ),
    { opacity: pulseOpacity * 0.14 },
  );
  const goalPoints = [
    [-1.3, 0, 12],
    [-1.3, 1.9, 12],
    [1.3, 1.9, 12],
    [1.3, 0, 12],
  ];
  add("goal", goalPoints.map(project), {
    opacity: entryEase(0.3, 0.6, t) * 0.85,
  });
  const net = [];
  for (let x = -1.3; x < 1.31; x += 0.325)
    net.push(entryPath([project([x, 0, 12.25]), project([x, 1.9, 12.25])]));
  for (let y = 0; y < 1.91; y += 0.317)
    net.push(entryPath([project([-1.3, y, 12.25]), project([1.3, y, 12.25])]));
  add("net", net.join(""), { opacity: entryEase(0.3, 0.6, t) * 0.2 });
  return { paths, background: entryEase(0, 0.2, t), width: w, height: h };
}
