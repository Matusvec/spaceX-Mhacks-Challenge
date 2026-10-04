import { decode } from "fast-png";
import type { SceneManifest } from "../contracts";

// Full-resolution terrain heights in the site frame. Row 0 is the north edge,
// column 0 is the west edge, and the grid is centered on the site origin.
export type Heightfield = {
  cols: number;
  rows: number;
  sizeM: [number, number];
  heights: Float32Array;
};

export function decodeHeightfield(png: ArrayBuffer, terrain: SceneManifest["terrain"]): Heightfield {
  // Canvas-based image decoding drops to 8 bits per channel, so decode the PNG ourselves.
  const image = decode(png);
  const maxValue = image.depth === 16 ? 65535 : 255;
  const range = terrain.z_max_m - terrain.z_min_m;
  const heights = new Float32Array(image.width * image.height);
  for (let i = 0; i < heights.length; i++) {
    const pixel = image.data[i * image.channels];
    heights[i] = terrain.z_min_m + (pixel / maxValue) * range;
  }
  return { cols: image.width, rows: image.height, sizeM: terrain.size_m, heights };
}

// Bilinear height at site (x east, y north), or null outside the terrain.
export function sampleHeight(field: Heightfield, x: number, y: number): number | null {
  const [width, depth] = field.sizeM;
  const col = ((x + width / 2) / width) * (field.cols - 1);
  const row = ((depth / 2 - y) / depth) * (field.rows - 1);
  if (col < 0 || row < 0 || col > field.cols - 1 || row > field.rows - 1) return null;

  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(c0 + 1, field.cols - 1);
  const r1 = Math.min(r0 + 1, field.rows - 1);
  const tc = col - c0;
  const tr = row - r0;
  const at = (r: number, c: number) => field.heights[r * field.cols + c];
  const north = at(r0, c0) * (1 - tc) + at(r0, c1) * tc;
  const south = at(r1, c0) * (1 - tc) + at(r1, c1) * tc;
  return north * (1 - tr) + south * tr;
}
