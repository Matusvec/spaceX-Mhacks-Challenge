// Writes scenes/placeholder-mars/: a synthetic bundle in the contracts.md format,
// so the viewer can be built before the real Mars and Moon bundles exist.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encode } from "fast-png";

const SCENE_ID = "placeholder-mars";
const SIZE_M = 1000;
const PIXELS = 501; // 2 m per pixel
const OUT_DIR = fileURLToPath(new URL(`../../../scenes/${SCENE_ID}/`, import.meta.url));

function bump(x, y, cx, cy, radius, height) {
  const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / radius ** 2;
  return height * Math.exp(-d2);
}

// x east, y north, in site meters; returns height in meters.
function heightAt(x, y) {
  const rolling = 3 * Math.sin(x / 61) * Math.cos(y / 47) + 1.5 * Math.sin((x + y) / 23);
  const hill = bump(x, y, 250, 250, 120, 45); // north-east
  const r = Math.hypot(x + 250, y + 250); // crater centered south-west
  const crater = -18 * Math.exp(-((r / 70) ** 2)) + 6 * Math.exp(-(((r - 90) / 25) ** 2));
  const centerFlatness = 1 - Math.exp(-((x ** 2 + y ** 2) / 120 ** 2));
  return rolling * centerFlatness + hill + crater;
}

const heights = new Float64Array(PIXELS * PIXELS);
for (let row = 0; row < PIXELS; row++) {
  for (let col = 0; col < PIXELS; col++) {
    // Pixel (0,0) is the north-west corner (contracts.md section 2).
    const x = -SIZE_M / 2 + (col / (PIXELS - 1)) * SIZE_M;
    const y = SIZE_M / 2 - (row / (PIXELS - 1)) * SIZE_M;
    heights[row * PIXELS + col] = heightAt(x, y);
  }
}

let zMin = Infinity;
let zMax = -Infinity;
for (const h of heights) {
  zMin = Math.min(zMin, h);
  zMax = Math.max(zMax, h);
}

const pixels = new Uint16Array(heights.length);
for (let i = 0; i < heights.length; i++) {
  pixels[i] = Math.round(((heights[i] - zMin) / (zMax - zMin)) * 65535);
}

const scene = {
  scene_id: SCENE_ID,
  body: "mars",
  title: "Placeholder terrain (synthetic)",
  site_origin_map: { x: 0, y: 0, z: 0 },
  map_crs: "none, synthetic placeholder",
  terrain: {
    file: "terrain.png",
    size_m: [SIZE_M, SIZE_M],
    resolution_m: SIZE_M / (PIXELS - 1),
    z_min_m: Number(zMin.toFixed(3)),
    z_max_m: Number(zMax.toFixed(3)),
  },
  pins: "pins.json",
  sources: [{ name: "Synthetic placeholder terrain, not real data", url: "" }],
};

const pins = [
  {
    id: 1,
    name: "Test pin (placeholder)",
    position_site: [0, 0, heightAt(0, 0)],
    kind: "placeholder",
    summary: "Placeholder pin for testing the viewer. Not real data.",
    measurements: [],
    source_urls: [],
  },
];

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_DIR + "terrain.png", encode({ width: PIXELS, height: PIXELS, data: pixels, depth: 16, channels: 1 }));
writeFileSync(OUT_DIR + "scene.json", JSON.stringify(scene, null, 2));
writeFileSync(OUT_DIR + "pins.json", JSON.stringify(pins, null, 2));
console.log(`Wrote ${OUT_DIR} (z ${zMin.toFixed(1)} to ${zMax.toFixed(1)} m)`);
