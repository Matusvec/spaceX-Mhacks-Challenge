import { SCORING } from "../config/scoring";
import type { RouteTarget, Rover } from "./useRover";
import { ROVER_SPEED_M_PER_S } from "../scene/roverDrive";

const WARPS = [1, 60, 600, 3600];

// Mission time as h:mm:ss.
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

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
          <dt>Drive time</dt>
          <dd>{clock(route.path.lengthM / ROVER_SPEED_M_PER_S)} at {Math.round(ROVER_SPEED_M_PER_S * 3600)} m/h</dd>
          <dt>Status</dt>
          <dd>{route.status === "driving" && rover.remainingS !== null ? `arrives in ${clock(rover.remainingS)}` : route.status}</dd>
        </dl>
      )}

      <p className="muted small">
        Time: {WARPS.map((w) => (
          <button key={w} className={w === rover.timeScale ? "active" : ""} onClick={() => rover.setTimeScale(w)}>
            {w === 1 ? "real time" : `${w}×`}
          </button>
        ))}
        <br />
        The rover drives at Perseverance's top speed on flat ground, 152 m per hour (NASA). The clock is mission time.
      </p>

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
