import { expect, test } from "vitest";
import { entryFrame, entryTargetArc, type EntryOrigin } from "./arena-geometry";
const origin = (): EntryOrigin => ({
  x: 500,
  y: 350,
  scale: 0.4,
  angle: -16,
  opacity: 0.04,
  facility: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
});
test("arena geometry stays finite through desktop phone and tablet entry frames", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
  ])
    for (const progress of [0, 0.1, 0.3, 0.56, 0.8, 1]) {
      const frame = entryFrame(progress, origin(), viewport);
      expect(Object.keys(frame.paths)).toHaveLength(47);
      for (const path of Object.values(frame.paths)) {
        expect(path.d).not.toMatch(/NaN|Infinity|undefined/);
        expect(path.opacity).toBeGreaterThanOrEqual(0);
        expect(path.opacity).toBeLessThanOrEqual(1);
      }
    }
});
test("entry uses circular target arcs and preserves all three target colours", () => {
  expect(entryTargetArc([10, 20], 5)).toContain("A5.000 5.000");
  const paths = entryFrame(0.6, origin(), { width: 1280, height: 800 }).paths;
  for (const name of ["targets", "targets-red", "targets-mint"]) {
    expect(paths[name].d).toContain("A");
    expect(paths[name].opacity).toBeGreaterThan(0);
  }
  expect(paths["pitch-brand"].d).not.toBe("");
  expect(paths.goal.d).not.toBe("");
});
