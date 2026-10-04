import { RAMP_CSS } from "../scene/colorRamp";
import { resolutionAndSource } from "./shortSource";
import { SplatQueryBox } from "./SplatQueryBox";
import type { SplatLayerState } from "./useSplatLayer";

const formatValue = (value: number) => value.toFixed(Math.abs(value) < 10 ? 2 : 1);

// Colors the splat by one per-Gaussian layer and shows its legend, source and resolution.
export function SplatLayersPanel({ layer }: { layer: SplatLayerState }) {
  const { selected, legend } = layer;
  if (!layer.hasLayers) return null;

  return (
    <section>
      <h2>Splat layers</h2>
      <label className="field">
        Color by
        <select
          value={selected?.name ?? ""}
          disabled={layer.unavailable !== null}
          onChange={(e) => layer.select(e.target.value || null)}
        >
          <option value="">None (photo colors)</option>
          {layer.fields.map((field) => (
            <option key={field.name} value={field.name}>
              {field.name}
              {field.estimate ? " (estimate)" : ""}
            </option>
          ))}
        </select>
      </label>
      {layer.unavailable && <p className="muted small">{layer.unavailable}</p>}
      {layer.error && <p className="error">{layer.error}</p>}
      {selected && !legend && !layer.error && <p className="muted small">Loading layer…</p>}

      {legend?.kind === "scalar" && (
        <>
          <div className="legend">
            <span>
              {formatValue(legend.min)} {selected?.unit}
            </span>
            <div className="legend-bar" style={{ background: RAMP_CSS }} />
            <span>
              {formatValue(legend.max)} {selected?.unit}
            </span>
          </div>
          <p className="muted small">Color range is the 2nd to 98th percentile; values outside it take the end colors.</p>
        </>
      )}
      {legend?.kind === "classes" && (
        <>
          <ul className="swatches small">
            {legend.classes.map((item) => (
              <li key={item.label}>
                <span className="swatch" style={{ background: item.color }} />
                {item.label}
              </li>
            ))}
          </ul>
          <p className="muted small">Most likely class per Gaussian. Gaussians with no class keep their photo color.</p>
        </>
      )}
      {selected?.estimate && legend && <p className="estimate small">Estimate, not a measurement.</p>}
      {selected && legend && (
        <p className="muted small">{resolutionAndSource(selected)}</p>
      )}
      <SplatQueryBox layer={layer} />
    </section>
  );
}
