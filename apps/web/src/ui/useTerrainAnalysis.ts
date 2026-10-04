import { useMemo } from "react";
import type { Body, SciencePin } from "../contracts";
import { buildRoverGrid, type RoverGrid } from "../paths/roverGrid";
import type { Heightfield } from "../scene/heightfield";
import type { LoadedBundle } from "../scene/loadBundle";
import { computeSlopeDeg } from "../scene/slope";

// Per-scene terrain data shared by base camp scoring and rover planning, computed once per bundle.
export type TerrainAnalysis = {
  body: Body;
  heightfield: Heightfield;
  slopeDeg: Float32Array;
  pins: SciencePin[];
  roverGrid: RoverGrid;
  resolutionM: number;
};

export function useTerrainAnalysis(bundle: LoadedBundle | null): TerrainAnalysis | null {
  return useMemo(() => {
    if (!bundle) return null;
    const slopeDeg = computeSlopeDeg(bundle.heightfield);
    return {
      body: bundle.manifest.body,
      heightfield: bundle.heightfield,
      slopeDeg,
      pins: bundle.pins,
      roverGrid: buildRoverGrid(bundle.heightfield, slopeDeg, bundle.manifest.body),
      resolutionM: bundle.manifest.terrain.resolution_m,
    };
  }, [bundle]);
}
