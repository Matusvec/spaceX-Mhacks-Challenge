// Writes scenes/placeholder-mars/: a synthetic bundle in the contracts.md format,
// so the viewer can be built before the real Mars and Moon bundles exist.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encode } from "fast-png";
import { encode3dgsPly } from "./write-3dgs-ply.mjs";

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

// Seeded random numbers, so every run writes the same file.
let seed = 42;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A fake rock outcrop near the test pin: Gaussians on the surfaces of a few
// partly buried ellipsoid boulders, in site coordinates on the terrain.
function makeOutcrop() {
  const boulders = [
    { center: [40, 30], radii: [8, 5, 4] },
    { center: [52, 24], radii: [5, 4, 3] },
    { center: [33, 40], radii: [3, 3, 2.5] },
    { center: [47, 40], radii: [6, 3, 2] },
  ];
  const gaussians = [];
  for (const { center, radii } of boulders) {
    const ground = heightAt(center[0], center[1]);
    const count = Math.round(1500 * radii[0] * radii[1]);
    for (let i = 0; i < count; i++) {
      const u = random() * 2 - 1;
      const theta = random() * 2 * Math.PI;
      const r = Math.sqrt(1 - u * u);
      const normal = [r * Math.cos(theta), r * Math.sin(theta), u];
      if (normal[2] < -0.3) continue; // buried part
      const shade = 0.65 + 0.35 * normal[2] + (random() - 0.5) * 0.15;
      const vein = Math.abs(Math.sin(normal[2] * 9 + normal[0] * 3)) > 0.93 ? 0.25 : 0;
      gaussians.push({
        position: [center[0] + normal[0] * radii[0], center[1] + normal[1] * radii[1], ground + normal[2] * radii[2]],
        color: [0.55, 0.42, 0.33].map((c) => Math.min(1, Math.max(0, c * shade + vein))),
        alpha: 0.9,
        sigma: [0.25, 0.25, 0.25],
        quaternion: [1, 0, 0, 0],
      });
    }
  }
  return gaussians;
}

const outcrop = makeOutcrop();

const scene = {
  scene_id: SCENE_ID,
  body: "mars",
  title: "Placeholder terrain (synthetic)",
  site_origin_map: { x: 0, y: 0, z: 0 },
  map_crs: "none, synthetic placeholder",
  splat: { file: "splat.ply", count: outcrop.length, sh_degree: 0, order_preserved: true },
  terrain: {
    file: "terrain.png",
    size_m: [SIZE_M, SIZE_M],
    resolution_m: SIZE_M / (PIXELS - 1),
    z_min_m: Number(zMin.toFixed(3)),
    z_max_m: Number(zMax.toFixed(3)),
  },
  pins: "pins.json",
  sources: [{ name: "Synthetic placeholder terrain and splat, not real data", url: "" }],
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
writeFileSync(OUT_DIR + "splat.ply", encode3dgsPly(outcrop));
console.log(`Wrote ${OUT_DIR} (z ${zMin.toFixed(1)} to ${zMax.toFixed(1)} m, ${outcrop.length} Gaussians)`);
