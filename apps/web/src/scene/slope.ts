import type { Heightfield } from "./heightfield";

// Slope in degrees for every heightfield cell, from central differences.
// Computed once per scene so scoring stays fast while dragging.
export function computeSlopeDeg(field: Heightfield): Float32Array {
  const { cols, rows, heights } = field;
  const dx = field.sizeM[0] / (cols - 1);
  const dy = field.sizeM[1] / (rows - 1);
  const slope = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const up = Math.max(row - 1, 0);
    const down = Math.min(row + 1, rows - 1);
    for (let col = 0; col < cols; col++) {
      const left = Math.max(col - 1, 0);
      const right = Math.min(col + 1, cols - 1);
      const dzdx = (heights[row * cols + right] - heights[row * cols + left]) / ((right - left) * dx);
      const dzdy = (heights[up * cols + col] - heights[down * cols + col]) / ((down - up) * dy);
      slope[row * cols + col] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }
  return slope;
}
