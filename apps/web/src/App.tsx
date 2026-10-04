import { useEffect, useState } from "react";
import type { HoverInfo } from "./scene/SceneRoot";
import { loadBundle, type LoadedBundle } from "./scene/loadBundle";
import { ScenePanel } from "./ui/ScenePanel";
import { ViewerCanvas } from "./ui/ViewerCanvas";

const DEFAULT_SCENE_ID = "placeholder-mars";

function sceneIdFromUrl(): string {
  return new URLSearchParams(window.location.search).get("scene") ?? DEFAULT_SCENE_ID;
}

export function App() {
  const [sceneId] = useState(sceneIdFromUrl);
  const [bundle, setBundle] = useState<LoadedBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo>(null);

  useEffect(() => {
    let cancelled = false;
    setBundle(null);
    setError(null);
    loadBundle(sceneId)
      .then((loaded) => !cancelled && setBundle(loaded))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  return (
    <div className="app">
      {bundle ? (
        <ScenePanel bundle={bundle} />
      ) : (
        <aside className="panel">
          <p className="eyebrow">Scene</p>
          <h1>{sceneId}</h1>
          {error ? <p className="error">Could not load scene: {error}</p> : <p className="muted">Loading…</p>}
        </aside>
      )}
      <main className="stage">
        <ViewerCanvas bundle={bundle} onHover={setHover} />
        {hover && (
          <div className="readout">
            x {hover.x.toFixed(1)} m E · y {hover.y.toFixed(1)} m N · elevation {hover.z.toFixed(2)} m
          </div>
        )}
      </main>
    </div>
  );
}
