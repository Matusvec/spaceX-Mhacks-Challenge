import { RAMP_CSS } from "../scene/colorRamp";
import { ShieldingSlider } from "./ShieldingSlider";
import { resolutionAndSource } from "./shortSource";
import type { RasterLayerState } from "./useRasterLayer";

// The one raster that shielding.json's factors apply to.
const SHIELDED_LAYER = "dose_estimate";

// Picks one terrain raster to drape on the terrain and shows its legend, source and resolution.
export function LayersPanel({ layer }: { layer: RasterLayerState }) {
  const { rasters, selected } = layer;
  if (rasters.length === 0) return null;
  // Long units ("band depth (dimensionless)") do not fit beside the legend bar; they get their own row.
  const shortUnit = selected && selected.unit.length <= 8 ? selected.unit : "";

  return (
    <section>
      <h2>Terrain layers</h2>
      <label className="field">
        Layer
        <select value={selected?.name ?? ""} onChange={(e) => layer.select(e.target.value || null)}>
          <option value="">None</option>
          {rasters.map((raster) => (
            <option key={raster.name} value={raster.name}>
              {raster.name}
              {raster.estimate ? " (estimate)" : ""}
            </option>
          ))}
        </select>
      </label>
      {layer.error && <p className="error">Could not load layer: {layer.error}</p>}
      {selected && (
        <>
          <div className="legend">
            <span>
              {selected.min} {shortUnit}
            </span>
            <div className="legend-bar" style={{ background: RAMP_CSS }} />
            <span>
              {selected.max} {shortUnit}
            </span>
          </div>
          {selected.coverage_pct !== undefined && selected.coverage_pct < 100 && (
            <p className="estimate small">
              Data covers {selected.coverage_pct}% of this terrain. Uncolored areas have no data, which is not a low
              value.
            </p>
          )}
          {selected.estimate && <p className="estimate small">Estimate, not a measurement.</p>}
          {selected.description && <p className="small">{selected.description}</p>}
          {!shortUnit && <p className="small">Unit: {selected.unit}</p>}
          <p className="muted small">{resolutionAndSource(selected)}</p>
          {layer.shielding && selected.name === SHIELDED_LAYER && (
            <ShieldingSlider shielding={layer.shielding} raster={selected} />
          )}
          <p className="muted small">The suitability map is hidden while a layer is shown.</p>
        </>
      )}
    </section>
  );
}
