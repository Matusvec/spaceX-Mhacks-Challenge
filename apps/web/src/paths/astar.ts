import { SCORING } from "../config/scoring";
import { gridIndexAt, gridPoint, type RoverGrid } from "./roverGrid";

export type RoverPath = {
  points: [number, number, number][];
  lengthM: number;
  maxSlopeDeg: number;
};

const NEIGHBORS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

// Minimal binary min-heap of grid indices keyed by priority.
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.items.length && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

function* passableNeighbors(grid: RoverGrid, index: number): Generator<[number, number]> {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  for (const [dr, dc] of NEIGHBORS) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
    const next = r * grid.cols + c;
    if (grid.passable[next]) yield [next, Math.hypot(dr, dc) * grid.cellM];
  }
}

// Safest-cheapest route from (x0, y0) to (x1, y1), or null if no route stays under the slope limit.
export function findRoverPath(grid: RoverGrid, x0: number, y0: number, x1: number, y1: number): RoverPath | null {
  const start = gridIndexAt(grid, x0, y0);
  const goal = gridIndexAt(grid, x1, y1);
  if (start < 0 || goal < 0 || !grid.passable[start] || !grid.passable[goal]) return null;

  const [gx, gy] = gridPoint(grid, goal);
  const heuristic = (i: number) => {
    const [x, y] = gridPoint(grid, i);
    return Math.hypot(x - gx, y - gy);
  };

  const cost = new Float64Array(grid.cols * grid.rows).fill(Infinity);
  const cameFrom = new Int32Array(grid.cols * grid.rows).fill(-1);
  const open = new MinHeap();
  cost[start] = 0;
  open.push(start, heuristic(start));

  while (open.size > 0) {
    const current = open.pop();
    if (current === goal) break;
    for (const [next, distance] of passableNeighbors(grid, current)) {
      const slope = (grid.slopeDeg[current] + grid.slopeDeg[next]) / 2;
      const candidate = cost[current] + distance * (1 + SCORING.roverSlopeCostPerDeg * slope);
      if (candidate < cost[next]) {
        cost[next] = candidate;
        cameFrom[next] = current;
        open.push(next, candidate + heuristic(next));
      }
    }
  }
  if (goal !== start && cameFrom[goal] < 0) return null;

  const indices: number[] = [];
  for (let i = goal; i >= 0; i = cameFrom[i]) indices.push(i);
  indices.reverse();

  const points = indices.map((i) => gridPoint(grid, i));
  let lengthM = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay, az] = points[i - 1];
    const [bx, by, bz] = points[i];
    lengthM += Math.hypot(bx - ax, by - ay, bz - az);
  }
  const maxSlopeDeg = Math.max(...indices.map((i) => grid.slopeDeg[i]));
  return { points, lengthM, maxSlopeDeg };
}

// Marks every cell the rover can drive to from (x, y) without exceeding the slope limit.
export function reachableFrom(grid: RoverGrid, x: number, y: number): Uint8Array {
  const reached = new Uint8Array(grid.cols * grid.rows);
  const start = gridIndexAt(grid, x, y);
  if (start < 0 || !grid.passable[start]) return reached;
  const queue = [start];
  reached[start] = 1;
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const [next] of passableNeighbors(grid, current)) {
      if (!reached[next]) {
        reached[next] = 1;
        queue.push(next);
      }
    }
  }
  return reached;
}
