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
        <dd>
          {Math.round(score.cutFillM3)} m³ to move
          {score.coverM3
            ? ` (leveling ${Math.round(score.cutFillM3 - score.coverM3)} + cover ${score.coverM!.toFixed(2)} m × footprint = ${Math.round(score.coverM3)})`
            : " (cut/fill)"}
        </dd>
        <dt>Science</dt>
        <dd>{score.distToScienceM === null ? "no pins" : `${Math.round(score.distToScienceM)} m to nearest pin`}</dd>
        <dt>Rover access</dt>
        <dd>{score.roverReachable === null ? "not computed yet" : score.roverReachable ? "reachable" : "blocked"}</dd>
        {score.illuminationPct !== undefined && (
          <>
            <dt>Sunlight</dt>
            <dd>{Math.round(score.illuminationPct)}% of the time</dd>
          </>
        )}
        {score.earthVisiblePct !== undefined && (
          <>
            <dt>Earth in view</dt>
            <dd>{Math.round(score.earthVisiblePct)}% of the time</dd>
          </>
        )}
        {score.doseEstimate_mSvPerYear !== undefined && (
          <>
            <dt>Radiation</dt>
            <dd>
              {Math.round(score.doseEstimate_mSvPerYear)} mSv/yr (estimate)
              {score.coverM ? `, under ${score.coverM.toFixed(2)} m of regolith; ${Math.round(score.doseUnshielded_mSvPerYear ?? 0)} with none` : ""}
            </dd>
          </>
        )}
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
