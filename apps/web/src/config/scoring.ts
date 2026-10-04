import type { Body, ModuleType } from "../contracts";

// Single source of truth for base-site scoring (docs/viewer-and-editing.md).
// Each penalty grows linearly from 0 at its threshold to its full weight at its "worst" value.
export const SCORING = {
  slopeLimitDeg: { habitat: 5, greenhouse_dome: 5, landing_pad: 3, solar_field: 10, tunnel: 15 } satisfies Record<ModuleType, number>,
  weights: { slope: 30, flatness: 15, cutFill: 15, science: 15, access: 15, moonSun: 5, moonEarth: 5 },
  scienceIdealM: 50,
  scienceMaxM: 500,
  roverSlopeLimitDeg: 30,
  // Full slope penalty once the max slope reaches this multiple of the module's limit.
  slopeWorstFactor: 2,
  // Full flatness penalty at this height standard deviation under the footprint.
  flatnessWorstM: 1,
  // Full cut/fill penalty when leveling moves this many meters of ground per square meter of footprint.
  cutFillWorstM3PerM2: 0.5,
};

export type Footprint = { shape: "rect"; lengthM: number; widthM: number } | { shape: "circle"; diameterM: number };

// Real-size footprints from the module library table. lengthM runs along the module's local X axis.
export function moduleFootprint(type: ModuleType, body: Body): Footprint {
  switch (type) {
    case "habitat":
      return { shape: "rect", lengthM: 8, widthM: 4 };
    case "greenhouse_dome":
      return { shape: "circle", diameterM: 10 };
    case "tunnel":
      return { shape: "rect", lengthM: 6, widthM: 2 };
    case "landing_pad":
      return { shape: "circle", diameterM: body === "moon" ? 50 : 30 };
    case "solar_field":
      return { shape: "rect", lengthM: 20, widthM: 20 };
  }
}

export const MODULE_LABELS: Record<ModuleType, string> = {
  habitat: "Habitat",
  greenhouse_dome: "Greenhouse dome",
  tunnel: "Tunnel",
  landing_pad: "Landing pad",
  solar_field: "Solar field",
};
