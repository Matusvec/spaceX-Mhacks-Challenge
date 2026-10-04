import { MODULE_LABELS } from "../config/scoring";
import { ConceptSection } from "../concept/ConceptSection";
import type { Concept } from "../concept/useConcept";
import type { ModuleType } from "../contracts";
import { Scorecard } from "./Scorecard";
import type { Basecamp } from "./useBasecamp";

const PLACEABLE: ModuleType[] = ["habitat", "greenhouse_dome", "landing_pad", "solar_field"];

export function BasecampPanel({ basecamp, concept }: { basecamp: Basecamp; concept: Concept }) {
  const { evaluation, placement } = basecamp;

  return (
    <section>
      <p className="eyebrow">Plan a base</p>
      <h1>Where to build</h1>

      <label className="field">
        Module
        <select value={basecamp.moduleType} onChange={(e) => basecamp.setModuleType(e.target.value as ModuleType)}>
          {PLACEABLE.map((type) => (
            <option key={type} value={type}>
              {MODULE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <h2>Suitability map</h2>
      <label className="checkbox">
        <input type="checkbox" checked={basecamp.showMap} onChange={(e) => basecamp.setShowMap(e.target.checked)} />
        Show grade for a {MODULE_LABELS[basecamp.moduleType].toLowerCase()} everywhere
      </label>
      <div className="legend">
        <span>0</span>
        <div className="legend-bar" />
        <span>100</span>
      </div>
      <p className="muted small">
        Computed from terrain heights
        {basecamp.resolutionM !== null && ` (${basecamp.resolutionM.toFixed(1)} m/px)`} and science pins. Fades out up close.
      </p>

      <h2>Best sites</h2>
      <ol className="sites">
        {basecamp.topSites.map((site, i) => (
          <li key={`${site.x},${site.y}`}>
            <button onClick={() => basecamp.goToSite(site)}>
              Site {i + 1} · grade {Math.round(site.grade)}
              <span className="muted">
                {" "}
                ({site.x.toFixed(0)}, {site.y.toFixed(0)}) m
              </span>
            </button>
          </li>
        ))}
      </ol>

      <h2>Selected placement</h2>
      <div className="buttons">
        <button className={basecamp.placing ? "active" : ""} onClick={() => basecamp.setPlacing(!basecamp.placing)}>
          {basecamp.placing ? "Done placing" : "Place module"}
        </button>
        {placement && (
          <>
            <button onClick={basecamp.rotate}>Rotate (R)</button>
            <button onClick={basecamp.removeModule}>Remove</button>
          </>
        )}
      </div>
      {basecamp.placing && <p className="muted small">Click or drag on the terrain to move it. R rotates.</p>}
      {evaluation && placement ? (
        <>
          <p className="muted small">
            {MODULE_LABELS[placement.type]} at ({placement.x.toFixed(0)}, {placement.y.toFixed(0)}) m, rotated{" "}
            {placement.rotationZDeg}°
          </p>
          <Scorecard score={evaluation.score} />
        </>
      ) : (
        <p className="muted">Pick a best site or place a module to see its scorecard.</p>
      )}

      <ConceptSection concept={concept} />
    </section>
  );
}
