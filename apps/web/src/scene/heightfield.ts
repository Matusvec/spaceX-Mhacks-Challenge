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

export function cellSizeM(field: Heightfield): number {
  return field.sizeM[0] / (field.cols - 1);
}

// Index of the nearest heightfield cell to site (x, y), or -1 outside the terrain.
export function nearestCellIndex(field: Heightfield, x: number, y: number): number {
  const [width, depth] = field.sizeM;
  const col = Math.round(((x + width / 2) / width) * (field.cols - 1));
  const row = Math.round(((depth / 2 - y) / depth) * (field.rows - 1));
  if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) return -1;
  return row * field.cols + col;
}

// Mesh vertices on the terrain edge are stored as float32, so they can land a rounding error outside
// (for example with size_m 1896.68). Counting them as outside put a wall of z = 0 along the edge.
const EDGE_CELLS = 1e-3;

// Bilinear height at site (x east, y north), or null outside the terrain.
export function sampleHeight(field: Heightfield, x: number, y: number): number | null {
  const [width, depth] = field.sizeM;
  const colRaw = ((x + width / 2) / width) * (field.cols - 1);
  const rowRaw = ((depth / 2 - y) / depth) * (field.rows - 1);
  if (colRaw < -EDGE_CELLS || rowRaw < -EDGE_CELLS || colRaw > field.cols - 1 + EDGE_CELLS || rowRaw > field.rows - 1 + EDGE_CELLS) {
    return null;
  }
  const col = Math.min(Math.max(colRaw, 0), field.cols - 1);
  const row = Math.min(Math.max(rowRaw, 0), field.rows - 1);

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
