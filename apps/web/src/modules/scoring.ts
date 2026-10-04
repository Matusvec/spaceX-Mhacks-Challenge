import { MODULE_LABELS, moduleFootprint, SCORING } from "../config/scoring";
import type { Body, ModuleType, Score, SciencePin } from "../contracts";
import { cellSizeM, nearestCellIndex, type Heightfield } from "../scene/heightfield";
import { sampleFootprint } from "./footprint";

export type ScoringContext = {
  body: Body;
  heightfield: Heightfield;
  slopeDeg: Float32Array;
  pins: SciencePin[];
};

export type SitePlacement = { type: ModuleType; x: number; y: number; rotationZDeg: number };

export type SiteEvaluation = {
  score: Score;
  // Median terrain height under the footprint; the module sits here once leveled.
  padHeightM: number;
  offTerrain: boolean;
};

// 0 at `start`, 1 at `end` and beyond.
function ramp(value: number, start: number, end: number): number {
  return Math.min(1, Math.max(0, (value - start) / (end - start)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function evaluateSite(site: SitePlacement, ctx: ScoringContext): SiteEvaluation {
  const { heightfield, slopeDeg } = ctx;
  const footprint = moduleFootprint(site.type, ctx.body);
  const { points, areaM2 } = sampleFootprint(footprint, site.x, site.y, site.rotationZDeg, cellSizeM(heightfield));

  const heights: number[] = [];
  let slopeSum = 0;
  let slopeMaxDeg = 0;
  for (const [px, py] of points) {
    const index = nearestCellIndex(heightfield, px, py);
    if (index < 0) return offTerrain();
    heights.push(heightfield.heights[index]);
    slopeSum += slopeDeg[index];
    slopeMaxDeg = Math.max(slopeMaxDeg, slopeDeg[index]);
  }

  const padHeightM = median(heights);
  const mean = heights.reduce((sum, h) => sum + h, 0) / heights.length;
  const flatnessM = Math.sqrt(heights.reduce((sum, h) => sum + (h - mean) ** 2, 0) / heights.length);
  const cellAreaM2 = areaM2 / heights.length;
  const cutFillM3 = heights.reduce((sum, h) => sum + Math.abs(h - padHeightM), 0) * cellAreaM2;

  const distToScienceM = ctx.pins.length
    ? Math.min(...ctx.pins.map((pin) => Math.hypot(pin.position_site[0] - site.x, pin.position_site[1] - site.y)))
    : null;

  const { weights } = SCORING;
  const limit = SCORING.slopeLimitDeg[site.type];
  const label = MODULE_LABELS[site.type].toLowerCase();
  const notes: string[] = [];
  let grade = 100;
  const penalize = (weight: number, fraction: number, note: string) => {
    const points = weight * fraction;
    grade -= points;
    if (points >= 1) notes.push(note);
  };

  penalize(
    weights.slope,
    ramp(slopeMaxDeg, limit, limit * SCORING.slopeWorstFactor),
    `max slope ${slopeMaxDeg.toFixed(1)}° exceeds ${limit}° limit for ${label}`,
  );
  penalize(
    weights.flatness,
    ramp(flatnessM, 0, SCORING.flatnessWorstM),
    `ground varies ${flatnessM.toFixed(2)} m (std dev) under the footprint`,
  );
  penalize(
    weights.cutFill,
    ramp(cutFillM3, 0, SCORING.cutFillWorstM3PerM2 * areaM2),
    `${Math.round(cutFillM3)} m³ of ground to move to level the pad`,
  );
  if (distToScienceM !== null) {
    penalize(
      weights.science,
      ramp(distToScienceM, SCORING.scienceIdealM, SCORING.scienceMaxM),
      `${Math.round(distToScienceM)} m to the nearest science pin (ideal under ${SCORING.scienceIdealM} m)`,
    );
  }

  return {
    score: {
      grade: Math.round(Math.max(0, grade)),
      slopeMeanDeg: slopeSum / points.length,
      slopeMaxDeg,
      flatnessM,
      cutFillM3,
      distToScienceM,
      roverReachable: null,
      notes,
    },
    padHeightM,
    offTerrain: false,
  };

  function offTerrain(): SiteEvaluation {
    return {
      score: {
        grade: 0,
        slopeMeanDeg: 0,
        slopeMaxDeg: 0,
        flatnessM: 0,
        cutFillM3: 0,
        distToScienceM: null,
        roverReachable: null,
        notes: ["footprint extends past the edge of the terrain"],
      },
      padHeightM: 0,
      offTerrain: true,
    };
  }
}
