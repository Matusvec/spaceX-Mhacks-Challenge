import { useCallback, useEffect, useMemo, useState } from "react";
import { findRoverPath, reachableFrom, type RoverPath } from "../paths/astar";
import { gridIndexAt } from "../paths/roverGrid";
import { sampleHeight } from "../scene/heightfield";
import type { SceneRoot } from "../scene/SceneRoot";
import type { TerrainAnalysis } from "./useTerrainAnalysis";

export type RouteTarget = { x: number; y: number; label: string };

export type RouteState = {
  target: RouteTarget;
  path: RoverPath | null;
  status: "planned" | "blocked" | "driving" | "arrived";
};

export function useRover(sceneRoot: SceneRoot | null, analysis: TerrainAnalysis | null) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [route, setRoute] = useState<RouteState | null>(null);

  useEffect(() => {
    // The scene origin is the scene center on the terrain surface (contracts.md section 1).
    setPosition(analysis ? { x: 0, y: 0 } : null);
    setRoute(null);
  }, [analysis]);

  const reachable = useMemo(
    () => (analysis && position ? reachableFrom(analysis.roverGrid, position.x, position.y) : null),
    [analysis, position],
  );

  const isReachable = useMemo(() => {
    if (!analysis || !reachable) return undefined;
    return (x: number, y: number) => {
      const index = gridIndexAt(analysis.roverGrid, x, y);
      return index >= 0 && reachable[index] === 1;
    };
  }, [analysis, reachable]);

  useEffect(() => {
    if (!sceneRoot) return;
    const z = position && analysis ? (sampleHeight(analysis.heightfield, position.x, position.y) ?? 0) : 0;
    sceneRoot.setRover(position && { ...position, z });
  }, [sceneRoot, analysis, position]);

  const path = route?.path ?? null;
  useEffect(() => sceneRoot?.setPath(path?.points ?? null), [sceneRoot, path]);

  const planRoute = useCallback(
    (target: RouteTarget): RouteState | null => {
      if (!analysis || !position) return null;
      const found = findRoverPath(analysis.roverGrid, position.x, position.y, target.x, target.y);
      const next: RouteState = { target, path: found, status: found ? "planned" : "blocked" };
      setRoute(next);
      return next;
    },
    [analysis, position],
  );

  const driveTo = useCallback(
    (target: RouteTarget): RouteState | null => {
      const planned = planRoute(target);
      if (!planned?.path || !sceneRoot) return planned;
      const { points } = planned.path;
      setRoute({ ...planned, status: "driving" });
      sceneRoot.driveRover(points, () => {
        const [x, y] = points[points.length - 1];
        setPosition({ x, y });
        setRoute((current) => current && { ...current, status: "arrived" });
      });
      return planned;
    },
    [planRoute, sceneRoot],
  );

  const reset = useCallback(() => {
    sceneRoot?.setRover(null);
    setRoute(null);
    setPosition(analysis ? { x: 0, y: 0 } : null);
  }, [sceneRoot, analysis]);

  return { position, route, isReachable, planRoute, driveTo, reset };
}

export type Rover = ReturnType<typeof useRover>;
