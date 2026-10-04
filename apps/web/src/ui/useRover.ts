import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// Multiplayer (src/multiplayer): told about this user's own drives and resets so the other clients can follow.
export type RoverSync = {
  onDrive(from: { x: number; y: number }, target: RouteTarget): void;
  onArrive(): void;
  onReset(): void;
};

export function useRover(sceneRoot: SceneRoot | null, analysis: TerrainAnalysis | null, sync?: RoverSync) {
  const syncRef = useRef(sync);
  syncRef.current = sync;
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
    sceneRoot.setRover(analysis ? position : null);
  }, [sceneRoot, analysis, position]);

  const path = route?.path ?? null;
  useEffect(() => sceneRoot?.setPath(path?.points ?? null), [sceneRoot, path]);

  const planRoute = useCallback(
    (target: RouteTarget, from = position): RouteState | null => {
      if (!analysis || !from) return null;
      const position = from;
      const found = findRoverPath(analysis.roverGrid, position.x, position.y, target.x, target.y);
      if (found) {
        // The planner works on grid cells; start and end on the exact points, not the cell centres.
        const z = (x: number, y: number) => sampleHeight(analysis.heightfield, x, y) ?? 0;
        if (found.points.length < 2) found.points.push(found.points[0]);
        found.points[0] = [position.x, position.y, z(position.x, position.y)];
        found.points[found.points.length - 1] = [target.x, target.y, z(target.x, target.y)];
        found.lengthM = found.points.reduce((sum, p, i, all) => (i ? sum + Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1], p[2] - all[i - 1][2]) : 0), 0);
      }
      const next: RouteState = { target, path: found, status: found ? "planned" : "blocked" };
      setRoute(next);
      return next;
    },
    [analysis, position],
  );

  const driveTo = useCallback(
    // `remoteFrom` is set when replaying a drive another client started: start there and do not re-announce it.
    (target: RouteTarget, remoteFrom?: { x: number; y: number }): RouteState | null => {
      const planned = planRoute(target, remoteFrom ?? position);
      if (!planned?.path || !sceneRoot) return planned;
      const { points } = planned.path;
      setRoute({ ...planned, status: "driving" });
      if (!remoteFrom && position) syncRef.current?.onDrive(position, target);
      sceneRoot.driveRover(points, () => {
        const [x, y] = points[points.length - 1];
        setPosition({ x, y });
        setRoute((current) => current && { ...current, status: "arrived" });
        syncRef.current?.onArrive();
      });
      return planned;
    },
    [planRoute, sceneRoot, position],
  );

  useEffect(() => {
    if (!sceneRoot) return;
    sceneRoot.setDriveHandler((x, y) => void driveTo({ x, y, label: `(${x.toFixed(1)}, ${y.toFixed(1)}) m` }));
    return () => sceneRoot.setDriveHandler(null);
  }, [sceneRoot, driveTo]);

  // `remote === true` when another client reset the rover (buttons pass a click event, which is not).
  const reset = useCallback((remote?: unknown) => {
    sceneRoot?.setRover(null);
    setRoute(null);
    setPosition(analysis ? { x: 0, y: 0 } : null);
    if (remote !== true) syncRef.current?.onReset();
  }, [sceneRoot, analysis]);

  // Time warp for drives, and the mission time left while one is running.
  const [timeScale, setTimeScale] = useState(600);
  const [remainingS, setRemainingS] = useState<number | null>(null);
  useEffect(() => sceneRoot?.setRoverTimeScale(timeScale), [sceneRoot, timeScale]);
  useEffect(() => {
    if (!sceneRoot) return;
    const timer = window.setInterval(() => setRemainingS(sceneRoot.roverRemainingS()), 200);
    return () => window.clearInterval(timer);
  }, [sceneRoot]);

  return { position, route, isReachable, planRoute, driveTo, reset, moveTo: setPosition, timeScale, setTimeScale, remainingS };
}

export type Rover = ReturnType<typeof useRover>;
