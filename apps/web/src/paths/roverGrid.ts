import { SCORING } from "../config/scoring";
import type { Body } from "../contracts";
import { cellSizeM, type Heightfield } from "../scene/heightfield";

// A coarser copy of the terrain for route planning. Row 0 is the north edge, like the heightfield.
export type RoverGrid = {
  cols: number;
  rows: number;
  cellM: number;
  width: number;
  depth: number;
  heights: Float32Array;
  // Steepest fine-resolution slope inside each cell, so narrow cliffs are not skipped.
  slopeDeg: Float32Array;
  passable: Uint8Array;
};

export function buildRoverGrid(field: Heightfield, fineSlopeDeg: Float32Array, body: Body): RoverGrid {
  const factor = Math.max(1, Math.round(SCORING.roverGridM[body] / cellSizeM(field)));
  const cols = Math.floor((field.cols - 1) / factor) + 1;
  const rows = Math.floor((field.rows - 1) / factor) + 1;
  const heights = new Float32Array(cols * rows);
  const slopeDeg = new Float32Array(cols * rows);
  const passable = new Uint8Array(cols * rows);
  const half = Math.floor(factor / 2);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const fineRow = row * factor;
      const fineCol = col * factor;
      let steepest = 0;
      for (let r = Math.max(0, fineRow - half); r <= Math.min(field.rows - 1, fineRow + half); r++) {
        for (let c = Math.max(0, fineCol - half); c <= Math.min(field.cols - 1, fineCol + half); c++) {
          steepest = Math.max(steepest, fineSlopeDeg[r * field.cols + c]);
        }
      }
      const i = row * cols + col;
      heights[i] = field.heights[fineRow * field.cols + fineCol];
      slopeDeg[i] = steepest;
      passable[i] = steepest <= SCORING.roverSlopeLimitDeg ? 1 : 0;
    }
  }
  const cellM = factor * cellSizeM(field);
  return { cols, rows, cellM, width: field.sizeM[0], depth: field.sizeM[1], heights, slopeDeg, passable };
}

export function gridIndexAt(grid: RoverGrid, x: number, y: number): number {
  const col = Math.round((x + grid.width / 2) / grid.cellM);
  const row = Math.round((grid.depth / 2 - y) / grid.cellM);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return -1;
  return row * grid.cols + col;
}

export function gridPoint(grid: RoverGrid, index: number): [number, number, number] {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return [-grid.width / 2 + col * grid.cellM, grid.depth / 2 - row * grid.cellM, grid.heights[index]];
}
