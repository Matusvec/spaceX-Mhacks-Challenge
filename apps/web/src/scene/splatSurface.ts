import { decode } from "fast-png";
import type { SceneManifest } from "../contracts";

// Height of the splat's own surface on a fine grid (docs/contracts.md: scene.json "splat_surface").
// The orbital terrain is 1 m per pixel, so the rocks the splat shows are only in here.
export type SplatSurface = {
  cols: number;
  rows: number;
  west: number;
  north: number;
  cellM: number;
  heights: Float32Array; // NaN where the splat has no data
};

export function decodeSplatSurface(png: ArrayBuffer, meta: NonNullable<SceneManifest["splat_surface"]>): SplatSurface {
  const image = decode(png);
  const heights = new Float32Array(image.width * image.height);
  for (let i = 0; i < heights.length; i++) {
    const pixel = image.data[i * image.channels];
    heights[i] = pixel === 0 ? NaN : meta.z_min_m + ((pixel - 1) / 65534) * (meta.z_max_m - meta.z_min_m);
  }
  return { cols: image.width, rows: image.height, west: meta.west_m, north: meta.north_m, cellM: meta.cell_m, heights };
}

// Bilinear surface height at site (x, y) over the cells that have data, or null where none of them do.
export function sampleSurface(surface: SplatSurface, x: number, y: number): number | null {
  const col = (x - surface.west) / surface.cellM - 0.5;
  const row = (surface.north - y) / surface.cellM - 0.5;
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  let sum = 0;
  let weight = 0;
  for (const [r, c, w] of [
    [r0, c0, (1 - (row - r0)) * (1 - (col - c0))],
    [r0, c0 + 1, (1 - (row - r0)) * (col - c0)],
    [r0 + 1, c0, (row - r0) * (1 - (col - c0))],
    [r0 + 1, c0 + 1, (row - r0) * (col - c0)],
  ]) {
    if (r < 0 || c < 0 || r >= surface.rows || c >= surface.cols) continue;
    const h = surface.heights[r * surface.cols + c];
    if (Number.isNaN(h)) continue;
    sum += h * w;
    weight += w;
  }
  return weight > 1e-6 ? sum / weight : null;
}
