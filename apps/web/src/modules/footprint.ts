import type { Footprint } from "../config/scoring";

export type FootprintSamples = { points: [number, number][]; areaM2: number };

// Sample points covering a footprint centered at (x, y) in site meters, rotated about +Z,
// spaced about `stepM` apart (the terrain resolution).
export function sampleFootprint(
  footprint: Footprint,
  x: number,
  y: number,
  rotationZDeg: number,
  stepM: number,
): FootprintSamples {
  const lengthM = footprint.shape === "rect" ? footprint.lengthM : footprint.diameterM;
  const widthM = footprint.shape === "rect" ? footprint.widthM : footprint.diameterM;
  const nu = Math.max(2, Math.ceil(lengthM / stepM));
  const nv = Math.max(2, Math.ceil(widthM / stepM));
  const cos = Math.cos((rotationZDeg * Math.PI) / 180);
  const sin = Math.sin((rotationZDeg * Math.PI) / 180);

  const points: [number, number][] = [];
  for (let i = 0; i < nu; i++) {
    const u = ((i + 0.5) / nu - 0.5) * lengthM;
    for (let j = 0; j < nv; j++) {
      const v = ((j + 0.5) / nv - 0.5) * widthM;
      if (footprint.shape === "circle" && Math.hypot(u, v) > footprint.diameterM / 2) continue;
      points.push([x + u * cos - v * sin, y + u * sin + v * cos]);
    }
  }

  const areaM2 = footprint.shape === "rect" ? lengthM * widthM : Math.PI * (footprint.diameterM / 2) ** 2;
  return { points, areaM2 };
}
