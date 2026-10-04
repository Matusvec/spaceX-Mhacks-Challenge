import type { Score } from "../contracts";
import { shortSource } from "./shortSource";
import { otherModelNote } from "../modules/siteValues";
import type { Basecamp } from "./useBasecamp";

/**
 * "Regolith cover" for the module being placed: shown only where the scene has cited shielding factors and the
 * module is a crew shelter. The dose and factor lines are estimates and say so, with their sources' short names.
 */
export function CoverControl({ basecamp, score }: { basecamp: Basecamp; score: Score }) {
  const { cover, coverSeries: series } = basecamp;
  if (!cover || !series || score.coverM === undefined || score.doseUnshielded_mSvPerYear === undefined) return null;
  const { points } = series;
  const how = points.find((point) => point.depth_m > 0 && point.how)?.how;
  const coverM = score.coverM;
  const factor = score.shieldingFactor ?? 1;
  // The cited values are not monotonic: a shallower stated depth can give a lower dose than the chosen one.
  const better = points.filter((point) => point.depth_m < coverM && point.factor < factor).sort((a, b) => a.factor - b.factor)[0];

  return (
    <div className="shielding small">
      <label className="field">
        Regolith cover: {coverM.toFixed(2)} m
        <input type="range" min={0} max={cover.maxM} step={0.01} value={coverM} onChange={(e) => basecamp.setCover(Number(e.target.value))} />
      </label>
      <div className="buttons">
        {points.map((point) => (
          <button key={point.depth_m} className={Math.abs(point.depth_m - coverM) < 0.005 ? "active" : ""} onClick={() => basecamp.setCover(point.depth_m)}>
            {point.depth_m.toFixed(2)} m
          </button>
        ))}
      </div>
      <p className="estimate">
        Estimate: {Math.round(score.doseUnshielded_mSvPerYear)} mSv/yr with no cover × {factor.toFixed(3)} at {coverM.toFixed(2)} m ={" "}
        {Math.round(score.doseEstimate_mSvPerYear ?? 0)} mSv/yr.
      </p>
      {better && (
        <p>
          More regolith is not always less dose in this range: the cited value at {better.depth_m.toFixed(2)} m (× {better.factor.toFixed(3)}) is
          lower than at this depth.
        </p>
      )}
      {otherModelNote(series, coverM, factor) && <p>{otherModelNote(series, coverM, factor)}</p>}
      <p className="muted">
        Cover is piled regolith: {coverM.toFixed(2)} m × the footprint is added to the ground to move. Factors: {shortSource(series.citation)}
        {how ? ` (${shortSource(how)})` : ""}, given at {points.map((point) => point.depth_m.toFixed(2)).join(", ")} m; straight lines between
        them are our choice; nothing is scored deeper than {cover.maxM.toFixed(2)} m.
      </p>
    </div>
  );
}
