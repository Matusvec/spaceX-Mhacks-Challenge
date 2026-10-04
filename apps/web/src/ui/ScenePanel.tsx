import type { ReactNode } from "react";
import type { LoadedBundle } from "../scene/loadBundle";

type Props = {
  children?: ReactNode; // the Layers section, shown between the scene facts and the pins
  bundle: LoadedBundle;
  presentation: boolean;
  onPresentation: (on: boolean) => void;
  onDrive?: (target: { x: number; y: number; label: string }) => void;
};

export function ScenePanel({ children, bundle, presentation, onPresentation, onDrive }: Props) {
  const { manifest, pins } = bundle;
  const [width, depth] = manifest.terrain.size_m;

  return (
    <section>
      <p className="eyebrow">{manifest.body === "mars" ? "Mars" : "Moon"}</p>
      <h1>{manifest.title}</h1>

      <dl>
        <dt>Extent</dt>
        <dd>
          {width} m × {depth} m
        </dd>
        <dt>Resolution</dt>
        <dd>{manifest.terrain.resolution_m.toFixed(1)} m/px</dd>
        <dt>Elevation</dt>
        <dd>
          {manifest.terrain.z_min_m.toFixed(1)} to {manifest.terrain.z_max_m.toFixed(1)} m
        </dd>
      </dl>

      {children}

      {pins.length > 0 && (
        <details className="fold" open>
          <summary>Pins and findings</summary>
          <ul>
            {pins.map((pin) => (
              <li key={pin.id}>
                <strong>{pin.name}</strong>
                {onDrive && (
                  <>
                    {" "}
                    <button className="link" onClick={() => onDrive({ x: pin.position_site[0], y: pin.position_site[1], label: pin.name })}>
                      Drive here
                    </button>
                  </>
                )}
                <br />
                <span className="muted">{pin.summary}</span>
                {pin.sample && (
                  <div className="small">
                    Sample: {pin.sample.name} (no. {pin.sample.number})
                  </div>
                )}
                {pin.measurements.length > 0 && (
                  <details className="small">
                    <summary>{pin.measurements.length} cited measurements</summary>
                    <ul>
                      {pin.measurements.map((m) => (
                        <li key={m.label}>
                          <strong>{m.label}</strong>
                          <br />
                          {m.value}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="fold">
        <summary>Display · real and cosmetic</summary>
      <label className="checkbox">
        <input type="checkbox" checked={presentation} onChange={(e) => onPresentation(e.target.checked)} />
        Presentation fill
      </label>
      <p className="muted small">
        Real: {manifest.splat ? "splat (rover photos), " : ""}terrain and image (orbit). Cosmetic: sky
        {manifest.body === "mars" ? ", haze" : ""}, ground beyond the window{manifest.splat ? ", soft splat edge" : ""}, fine
        grain. Off shows only the data.
      </p>
      </details>
    </section>
  );
}
