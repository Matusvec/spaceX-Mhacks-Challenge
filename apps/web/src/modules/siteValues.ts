import { decode } from "fast-png";
import { SCORING } from "../config/scoring";
import type { ModuleType, RasterLayer, Shielding } from "../contracts";
import { shieldingFactor } from "../scene/shielding";

// Per-site numbers for the Moon score (docs/viewer-and-editing.md, scoring step 7): the scene's own rasters sampled
// at the module center, and the dose behind a regolith cover from the scene's cited shielding factors.
// Nothing here is a constant of ours except the straight lines between the cited shielding points.

const NAMES = ["illumination_pct", "earth_visible_pct", "dose_estimate"] as const;
type Name = (typeof NAMES)[number];
type Grid = { cols: number; rows: number; values: Float32Array; raster: RasterLayer }; // NaN = no data

export type SiteValues = { sizeM: [number, number]; grids: Partial<Record<Name, Grid>>; shielding: Shielding | null };

/** Decodes the rasters the score reads (contracts.md section 5: pixel 0..max maps to raster.min..raster.max). */
export async function loadSiteValues(
  rasters: (RasterLayer & { url: string })[],
  sizeM: [number, number],
  shielding: Shielding | null,
): Promise<SiteValues> {
  const grids: SiteValues["grids"] = {};
  for (const name of NAMES) {
    const raster = rasters.find((r) => r.name === name);
    if (!raster) continue;
    const response = await fetch(raster.url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} loading ${raster.url}`);
    const image = decode(await response.arrayBuffer());
    const maxPixel = image.depth === 16 ? 65535 : 255;
    const hasAlpha = image.channels === 2 || image.channels === 4;
    const values = new Float32Array(image.width * image.height);
    for (let i = 0; i < values.length; i++) {
      const at = i * image.channels;
      const empty = hasAlpha && image.data[at + image.channels - 1] === 0;
      values[i] = empty ? NaN : raster.min + (image.data[at] / maxPixel) * (raster.max - raster.min);
    }
    grids[name] = { cols: image.width, rows: image.height, values, raster };
  }
  return { sizeM, grids, shielding };
}

// The raster covers the terrain window; row 0 is the north edge. Null outside it or where it has no data.
function sample(values: SiteValues, name: Name, x: number, y: number): number | null {
  const grid = values.grids[name];
  if (!grid) return null;
  const [width, depth] = values.sizeM;
  if (Math.abs(x) > width / 2 || Math.abs(y) > depth / 2) return null;
  // A point exactly on the east or south edge belongs to the last cell, not to a cell past it.
  const col = Math.min(grid.cols - 1, Math.floor(((x + width / 2) / width) * grid.cols));
  const row = Math.min(grid.rows - 1, Math.floor(((depth / 2 - y) / depth) * grid.rows));
  const value = grid.values[row * grid.cols + col];
  return Number.isNaN(value) ? null : value;
}

export type CoverSeries = { points: Shielding["points"]; citation: string; other: { points: Shielding["points"]; citation: string } | null };

/**
 * The one cited series a module's cover is scored with: the file's deeper series when it has one, else its
 * original points. One module, one series: the two are never merged, since their baselines differ.
 * `other` is a second model for the same depths, kept only to say where it disagrees.
 */
export function coverSeries(shielding: Shielding | null | undefined): CoverSeries | null {
  if (!shielding) return null;
  if (!shielding.points_deep?.length) return shielding.points.length ? { points: shielding.points, citation: shielding.source.citation, other: null } : null;
  const alt = shielding.points_deep_deangelis2002;
  return {
    points: shielding.points_deep,
    citation: shielding.series?.points_deep?.source.citation ?? shielding.source.citation,
    other: alt?.length ? { points: alt, citation: shielding.series?.points_deep_deangelis2002?.source.citation ?? "another model" } : null,
  };
}

/** Whether regolith cover is scored for this module here: a crew shelter, in a scene with cited shielding factors. */
export function coverRange(values: SiteValues | null | undefined, type: ModuleType): { maxM: number } | null {
  const points = coverSeries(values?.shielding)?.points;
  if (!points?.length || !values?.grids.dose_estimate || !SCORING.coverable.includes(type)) return null;
  return { maxM: points[points.length - 1].depth_m }; // never beyond the deepest cited depth
}

export type MoonTerms = {
  illuminationPct?: number;
  earthVisiblePct?: number;
  doseUnshielded_mSvPerYear?: number;
  doseEstimate_mSvPerYear?: number; // behind the cover, if any
  coverM?: number;
  coverM3?: number;
  shieldingFactor?: number;
  penalties: { weight: number; fraction: number; note: string }[];
};

/** The Moon part of a module's score at (x, y) with `coverM` of regolith over it. Empty when the scene has no rasters. */
export function moonTerms(
  values: SiteValues | null | undefined,
  site: { type: ModuleType; x: number; y: number; coverM?: number },
  footprintAreaM2: number,
): MoonTerms {
  const terms: MoonTerms = { penalties: [] };
  if (!values) return terms;
  const { weights } = SCORING;
  const sun = sample(values, "illumination_pct", site.x, site.y);
  if (sun !== null) {
    terms.illuminationPct = sun;
    terms.penalties.push({ weight: weights.moonSun, fraction: 1 - sun / 100, note: `sunlight ${Math.round(sun)}% of the time` });
  }
  const earth = sample(values, "earth_visible_pct", site.x, site.y);
  if (earth !== null) {
    terms.earthVisiblePct = earth;
    terms.penalties.push({ weight: weights.moonEarth, fraction: 1 - earth / 100, note: `Earth in view ${Math.round(earth)}% of the time` });
  }
  const dose = sample(values, "dose_estimate", site.x, site.y);
  if (dose === null) return terms;
  terms.doseUnshielded_mSvPerYear = dose;
  terms.doseEstimate_mSvPerYear = dose;
  if (!SCORING.coverable.includes(site.type)) return terms; // only crew shelters are scored on dose

  const range = coverRange(values, site.type);
  const points = coverSeries(values.shielding)?.points ?? [];
  if (range) {
    const coverM = Math.min(Math.max(site.coverM ?? 0, 0), range.maxM);
    terms.coverM = coverM;
    terms.shieldingFactor = shieldingFactor(points, coverM);
    terms.doseEstimate_mSvPerYear = dose * terms.shieldingFactor;
    terms.coverM3 = coverM * footprintAreaM2; // the regolith that has to be piled on: cover depth x footprint area
  }
  // Penalty scale, all from the scene's own files: from the lowest dose this scene can reach (lowest dose on the
  // map behind the best cited cover) to the highest unshielded dose on the map.
  const raster = values.grids.dose_estimate!.raster;
  const best = raster.min * Math.min(1, ...points.map((point) => point.factor));
  const shielded = terms.doseEstimate_mSvPerYear;
  terms.penalties.push({
    weight: weights.moonDose,
    fraction: Math.min(1, Math.max(0, (shielded - best) / (raster.max - best))),
    note: `radiation dose estimate ${Math.round(shielded)} ${raster.unit}${terms.coverM ? ` under ${terms.coverM.toFixed(2)} m of regolith` : ", no regolith cover"}`,
  });
  return terms;
}

/** One line where the second model gives a clearly different factor at this depth; null when it agrees or has no value there. */
export function otherModelNote(series: CoverSeries, coverM: number, factor: number): string | null {
  const other = series.other;
  if (!other || coverM <= 0 || coverM > other.points[other.points.length - 1].depth_m) return null;
  const theirs = shieldingFactor(other.points, coverM);
  if (Math.abs(theirs - factor) < 0.1) return null;
  const name = other.citation.match(/^([^,]+),.*?\((\d{4})\)/);
  return `An older model (${name ? `${name[1]} et al. ${name[2]}` : other.citation}) gives × ${theirs.toFixed(2)} at this depth, not × ${factor.toFixed(2)}.`;
}
