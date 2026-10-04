import type { Score } from "../contracts";
import { gradeColor } from "../scene/basecampOverlay";

export function Scorecard({ score }: { score: Score }) {
  return (
    <div className="scorecard">
      <div className="grade" style={{ color: `#${gradeColor(score.grade).getHexString()}` }}>
        {score.grade}
        <span className="muted"> / 100</span>
      </div>
      <dl>
        <dt>Slope</dt>
        <dd>
          {score.slopeMeanDeg.toFixed(1)}° mean, {score.slopeMaxDeg.toFixed(1)}° max
        </dd>
        <dt>Flatness</dt>
        <dd>{score.flatnessM.toFixed(2)} m std dev</dd>
        <dt>Leveling</dt>
        <dd>{Math.round(score.cutFillM3)} m³ cut/fill</dd>
        <dt>Science</dt>
        <dd>{score.distToScienceM === null ? "no pins" : `${Math.round(score.distToScienceM)} m to nearest pin`}</dd>
        <dt>Rover access</dt>
        <dd>{score.roverReachable === null ? "not computed yet" : score.roverReachable ? "reachable" : "blocked"}</dd>
      </dl>
      {score.notes.length > 0 ? (
        <ul className="notes">
          {score.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No penalties.</p>
      )}
    </div>
  );
}
