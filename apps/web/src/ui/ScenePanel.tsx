import type { LoadedBundle } from "../scene/loadBundle";

export function ScenePanel({ bundle }: { bundle: LoadedBundle }) {
  const { manifest, pins } = bundle;
  const [width, depth] = manifest.terrain.size_m;

  return (
    <aside className="panel">
      <p className="eyebrow">{manifest.body === "mars" ? "Mars" : "Moon"}</p>
      <h1>{manifest.title}</h1>

      <h2>Terrain</h2>
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

      <h2>Sources</h2>
      <ul>
        {manifest.sources.map((source) => (
          <li key={source.name}>{source.url ? <a href={source.url}>{source.name}</a> : source.name}</li>
        ))}
      </ul>

      {pins.length > 0 && (
        <>
          <h2>Pins</h2>
          <ul>
            {pins.map((pin) => (
              <li key={pin.id}>
                <strong>{pin.name}</strong>
                <br />
                <span className="muted">{pin.summary}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
