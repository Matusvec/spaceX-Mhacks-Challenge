import { SCORING } from "../config/scoring";
import type { RouteTarget, Rover } from "./useRover";

type Props = {
  rover: Rover;
  selectedTarget: RouteTarget | null;
};

export function RoverPanel({ rover, selectedTarget }: Props) {
  const { position, route } = rover;

  return (
    <section>
      <h2>Rover</h2>
      {position && (
        <p className="muted small">
          At ({position.x.toFixed(0)}, {position.y.toFixed(0)}) m. Avoids slopes over {SCORING.roverSlopeLimitDeg}°.
          <br />
          Double-click anywhere on the terrain to send the rover there.
        </p>
      )}

      {route?.status === "blocked" && (
        <p className="error">
          No safe route to {route.target.label}: every way there crosses slopes over {SCORING.roverSlopeLimitDeg}°.
        </p>
      )}
      {route?.path && (
        <dl>
          <dt>Route to</dt>
          <dd>{route.target.label}</dd>
          <dt>Length</dt>
          <dd>{Math.round(route.path.lengthM)} m</dd>
          <dt>Max slope</dt>
          <dd>{route.path.maxSlopeDeg.toFixed(1)}°</dd>
          <dt>Status</dt>
          <dd>{route.status === "driving" ? "driving (sped up)…" : route.status}</dd>
        </dl>
      )}

      <div className="buttons">
        <button
          disabled={!selectedTarget || route?.status === "driving"}
          onClick={() => selectedTarget && rover.driveTo(selectedTarget)}
        >
          Drive to selected placement
        </button>
        <button disabled={route?.status === "driving"} onClick={rover.reset}>
          Reset rover
        </button>
      </div>
    </section>
  );
}
