import { useState } from "react";
import type { RasterLayer, Shielding } from "../contracts";
import { shieldingFactor } from "../scene/shielding";
import { shortSource } from "./shortSource";

// How much regolith cover would change the dose layer's numbers. Numbers only: the factor is one
// value for the whole map, so the map's colors stay as they are.
export function ShieldingSlider({ shielding, raster }: { shielding: Shielding; raster: RasterLayer }) {
  const [depthM, setDepthM] = useState(0);
  const { points } = shielding;
  const maxDepthM = points[points.length - 1].depth_m;
  const factor = shieldingFactor(points, depthM);
  const stated = points.find((point) => Math.abs(point.depth_m - depthM) < 1e-6);
  const rises = points.some((point, i) => i > 0 && point.factor > points[i - 1].factor);

  return (
    <div className="shielding small">
      <label className="field">
        Regolith over the habitat: {depthM.toFixed(2)} m
        <input
          type="range"
          min={0}
          max={maxDepthM}
          step={0.01}
          value={depthM}
          list="shielding-depths"
          onChange={(e) => setDepthM(Number(e.target.value))}
        />
      </label>
      <datalist id="shielding-depths">
        {points.map((point) => (
          <option key={point.depth_m} value={point.depth_m} />
        ))}
      </datalist>
      <p className="estimate">
        Estimate: dose × {factor.toFixed(2)} = {Math.round(raster.min * factor)} to {Math.round(raster.max * factor)}{" "}
        {raster.unit} with this cover (the map shows {raster.min} to {raster.max} with none).
      </p>
      <p>The paper states four values; press one to set the slider to it:</p>
      <div className="buttons">
        {points.map((point) => (
          <button key={point.depth_m} className={point === stated ? "active" : ""} onClick={() => setDepthM(point.depth_m)}>
            {point.depth_m.toFixed(2)} m: × {point.factor.toFixed(2)}
          </button>
        ))}
      </div>
      {stated ? (
        <p>
          Stated in the paper at this depth: “{stated.quote}”
        </p>
      ) : (
        <p>Between those depths the factor is linear between the paper's four stated values. The straight lines are our choice.</p>
      )}
      {rises && <p>More regolith does not always mean less dose in this range.</p>}
      <p className="muted">The map colors do not change: the factor is one number for the whole map.</p>
      <p className="muted">Factors: {shortSource(shielding.source.citation)}</p>
      <details>
        <summary>Limits</summary>
        <p>{shielding.limits}</p>
        <p className="muted">Depth: {shielding.unit_depth}</p>
      </details>
    </div>
  );
}
