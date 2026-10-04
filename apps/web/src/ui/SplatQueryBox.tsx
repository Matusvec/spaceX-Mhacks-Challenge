import { useState, type FormEvent } from "react";
import { HIGHLIGHT_HEX } from "../scene/colorRamp";
import { resolutionAndSource } from "./shortSource";
import type { SplatLayerState } from "./useSplatLayer";

// Text search over the splat: highlights the Gaussians whose look-alike group fits a description.
export function SplatQueryBox({ layer }: { layer: SplatLayerState }) {
  const [text, setText] = useState("");
  const { query, matched, clusterField } = layer;
  if (!clusterField) return null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void layer.search(text);
  };

  return (
    <>
      <form onSubmit={onSubmit}>
        <label className="field">
          Find by description
          <input
            name="splat-query"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="rock, or sand between the rocks"
            disabled={layer.queryUnavailable !== null}
          />
        </label>
        <div className="buttons">
          <button type="submit" disabled={layer.queryUnavailable !== null || layer.searching || !text.trim()}>
            Find
          </button>
          {query && (
            <button type="button" onClick={layer.clearQuery}>
              Clear
            </button>
          )}
        </div>
      </form>
      {layer.suggestions.length > 0 && !layer.queryUnavailable && (
        <>
          <div className="buttons">
            {layer.suggestions.map((phrase) => (
              <button
                key={phrase}
                type="button"
                disabled={layer.searching}
                onClick={() => {
                  setText(phrase);
                  void layer.search(phrase);
                }}
              >
                {phrase}
              </button>
            ))}
          </div>
          <p className="muted small">
            This hosted copy answers only these searches, computed ahead with the team's CLIP backend. Open search
            needs that backend running.
          </p>
        </>
      )}
      {layer.queryUnavailable && <p className="muted small">{layer.queryUnavailable}</p>}
      {layer.searching && layer.suggestions.length === 0 && (
        <p className="muted small">Searching… the first search loads the model and takes a few seconds.</p>
      )}
      {query && matched !== null && (
        <>
          <p className="small">
            <span className="swatch" style={{ background: HIGHLIGHT_HEX }} />
            {matched.toLocaleString()} of {layer.total.toLocaleString()} Gaussians (
            {((100 * matched) / Math.max(layer.total, 1)).toFixed(0)}%) highlighted for “{query.text}”.
          </p>
          <p className="estimate small">Estimate, not a measurement.</p>
          <p className="small">
            This tells discrete rocks from the ground between them. It does not tell rock types apart: different
            rock descriptions highlight mostly the same rocks.
          </p>
          <p className="muted small">{query.explanation}</p>
          <p className="muted small">{resolutionAndSource(clusterField)}</p>
        </>
      )}
    </>
  );
}
