import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModuleType } from "../contracts";
import { evaluateSite, type ScoringContext, type SitePlacement } from "../modules/scoring";
import { computeSuitability, findTopSites, siteSeparationM, type CandidateSite } from "../modules/siteSearch";
import { sampleHeight } from "../scene/heightfield";
import type { SceneRoot } from "../scene/SceneRoot";
import type { TerrainAnalysis } from "./useTerrainAnalysis";

const TOP_SITE_COUNT = 3;
const ROTATE_STEP_DEG = 15;

// `analysis` must be for the bundle SceneRoot is currently showing, so overlays are drawn after it.
export function useBasecamp(
  sceneRoot: SceneRoot | null,
  analysis: TerrainAnalysis | null,
  isReachable: ((x: number, y: number) => boolean) | undefined,
) {
  const [moduleType, setModuleTypeState] = useState<ModuleType>("habitat");
  const [showMap, setShowMap] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [placement, setPlacement] = useState<SitePlacement | null>(null);

  const ctx = useMemo<ScoringContext | null>(() => analysis && { ...analysis, isReachable }, [analysis, isReachable]);
  const grid = useMemo(() => (ctx ? computeSuitability(moduleType, ctx) : null), [ctx, moduleType]);
  const topSites = useMemo(
    () => (grid && ctx ? findTopSites(grid, TOP_SITE_COUNT, siteSeparationM(moduleType, ctx)) : []),
    [grid, ctx, moduleType],
  );
  const evaluation = useMemo(() => (placement && ctx ? evaluateSite(placement, ctx) : null), [placement, ctx]);

  useEffect(() => {
    setPlacement(null);
    setPlacing(false);
  }, [analysis]);

  useEffect(() => sceneRoot?.setSuitability(showMap ? grid : null), [sceneRoot, grid, showMap]);
  useEffect(() => sceneRoot?.setSiteMarkers(topSites), [sceneRoot, topSites]);
  useEffect(() => {
    sceneRoot?.setModule(placement && evaluation ? { ...placement, z: evaluation.padHeightM } : null);
  }, [sceneRoot, placement, evaluation]);

  useEffect(() => {
    if (!sceneRoot || !placing) return;
    sceneRoot.setPlaceHandler((x, y) =>
      setPlacement((current) => ({ type: moduleType, x, y, rotationZDeg: current?.rotationZDeg ?? 0 })),
    );
    return () => sceneRoot.setPlaceHandler(null);
  }, [sceneRoot, placing, moduleType]);

  const rotate = useCallback(() => {
    setPlacement((current) => current && { ...current, rotationZDeg: (current.rotationZDeg + ROTATE_STEP_DEG) % 360 });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if (!typing && event.key.toLowerCase() === "r") rotate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rotate]);

  const setModuleType = (type: ModuleType) => {
    setModuleTypeState(type);
    setPlacement((current) => current && { ...current, type });
  };

  const evaluateAt = (x: number, y: number) =>
    ctx ? evaluateSite({ type: moduleType, x, y, rotationZDeg: 0 }, ctx).score : null;

  const findSites = (count: number) => (grid && ctx ? findTopSites(grid, count, siteSeparationM(moduleType, ctx)) : []);

  const placeAt = (type: ModuleType, x: number, y: number) => {
    setModuleTypeState(type);
    setPlacement({ type, x, y, rotationZDeg: 0 });
    return ctx ? evaluateSite({ type, x, y, rotationZDeg: 0 }, ctx).score : null;
  };

  const goToSite = (site: CandidateSite) => {
    setPlacement({ type: moduleType, x: site.x, y: site.y, rotationZDeg: 0 });
    const z = analysis ? (sampleHeight(analysis.heightfield, site.x, site.y) ?? 0) : 0;
    sceneRoot?.flyToSite(site.x, site.y, z, 120);
  };

  return {
    moduleType,
    setModuleType,
    showMap,
    setShowMap,
    placing,
    setPlacing,
    topSites,
    placement,
    evaluation,
    goToSite,
    evaluateAt,
    findSites,
    placeAt,
    rotate,
    removeModule: () => setPlacement(null),
    resolutionM: analysis?.resolutionM ?? null,
  };
}

export type Basecamp = ReturnType<typeof useBasecamp>;
