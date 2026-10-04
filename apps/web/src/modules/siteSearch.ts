import { moduleFootprint } from "../config/scoring";
import type { ModuleType } from "../contracts";
import { evaluateSite, type ScoringContext } from "./scoring";

const MAX_GRID_STEPS = 120;

// Grades on a regular grid over the terrain. Row 0 is the south edge, column 0 the west
// edge (texture order). Cells whose footprint leaves the terrain are NaN.
export type SuitabilityGrid = {
  type: ModuleType;
  cols: number;
  rows: number;
  stepM: number;
  originX: number;
  originY: number;
  grades: Float32Array;
};

export type CandidateSite = { x: number; y: number; grade: number };

export function computeSuitability(type: ModuleType, ctx: ScoringContext): SuitabilityGrid {
  const [width, depth] = ctx.heightfield.sizeM;
  const stepM = Math.max(width, depth) / MAX_GRID_STEPS;
  const cols = Math.floor(width / stepM) + 1;
  const rows = Math.floor(depth / stepM) + 1;
  const originX = -width / 2;
  const originY = -depth / 2;
  const grades = new Float32Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const site = { type, x: originX + col * stepM, y: originY + row * stepM, rotationZDeg: 0 };
      const { score, offTerrain } = evaluateSite(site, ctx);
      grades[row * cols + col] = offTerrain ? NaN : score.grade;
    }
  }
  return { type, cols, rows, stepM, originX, originY, grades };
}

// The best `count` grid cells, each at least `minSeparationM` from the ones already picked.
export function findTopSites(grid: SuitabilityGrid, count: number, minSeparationM: number): CandidateSite[] {
  const order = Array.from(grid.grades.keys())
    .filter((i) => !Number.isNaN(grid.grades[i]))
    .sort((a, b) => grid.grades[b] - grid.grades[a]);

  const picked: CandidateSite[] = [];
  for (const i of order) {
    const x = grid.originX + (i % grid.cols) * grid.stepM;
    const y = grid.originY + Math.floor(i / grid.cols) * grid.stepM;
    if (picked.every((p) => Math.hypot(p.x - x, p.y - y) >= minSeparationM)) {
      picked.push({ x, y, grade: grid.grades[i] });
      if (picked.length === count) break;
    }
  }
  return picked;
}

export function siteSeparationM(type: ModuleType, ctx: ScoringContext): number {
  const footprint = moduleFootprint(type, ctx.body);
  const size = footprint.shape === "rect" ? Math.max(footprint.lengthM, footprint.widthM) : footprint.diameterM;
  return Math.max(60, size * 4);
}
