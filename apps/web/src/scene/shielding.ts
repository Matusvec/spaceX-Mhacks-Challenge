import type { Shielding } from "../contracts";

// Dose factor at `depthM` of regolith: straight lines between the stated points (our choice, not the
// source's), and never beyond the first or last point: outside that range the nearest point is used.
export function shieldingFactor(points: Shielding["points"], depthM: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (depthM <= first.depth_m) return first.factor;
  if (depthM >= last.depth_m) return last.factor;
  const upper = points.findIndex((point) => point.depth_m >= depthM);
  const a = points[upper - 1];
  const b = points[upper];
  return a.factor + ((b.factor - a.factor) * (depthM - a.depth_m)) / (b.depth_m - a.depth_m);
}

if (import.meta.env.DEV) {
  const line = [
    { depth_m: 0, factor: 1 },
    { depth_m: 1, factor: 0.5 },
  ] as Shielding["points"];
  console.assert(shieldingFactor(line, 0.5) === 0.75 && shieldingFactor(line, 2) === 0.5 && shieldingFactor(line, -1) === 1);
}
