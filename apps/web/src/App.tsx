import { useEffect, useState, type DragEvent } from "react";
import type { HoverInfo, SceneRoot } from "./scene/SceneRoot";
import { bundleFileUrl, loadBundle, type LoadedBundle } from "./scene/loadBundle";
import { isSplatFileName, SPLAT_EXTENSIONS } from "./scene/splat";
import { BasecampPanel } from "./ui/BasecampPanel";
import { ScenePanel } from "./ui/ScenePanel";
import { useBasecamp } from "./ui/useBasecamp";
import { SplatPanel } from "./ui/SplatPanel";
import { useSplatLoader } from "./ui/useSplatLoader";
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
  const [sceneRoot, setSceneRoot] = useState<SceneRoot | null>(null);
  const [dragging, setDragging] = useState(false);
  const [displayedBundle, setDisplayedBundle] = useState<LoadedBundle | null>(null);
  const splat = useSplatLoader(sceneRoot);
  const { load: loadSplat, fail: failSplat } = splat;
  const basecamp = useBasecamp(sceneRoot, displayedBundle);

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

  useEffect(() => {
    setDisplayedBundle(null);
    if (!sceneRoot || !bundle) return;
    sceneRoot.setBundle(bundle);
    setDisplayedBundle(bundle);
    const splatFile = bundle.manifest.splat?.file;
    if (splatFile) {
      loadSplat({ kind: "bundle", url: bundleFileUrl(bundle.manifest.scene_id, splatFile), name: splatFile });
    }
  }, [sceneRoot, bundle, loadSplat]);

  const openFile = (file: File) => {
    if (isSplatFileName(file.name)) {
      loadSplat({ kind: "file", file });
    } else {
      failSplat(file.name, `not a splat file. Use ${SPLAT_EXTENSIONS.join(", ")}.`);
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    setDragging(true);
  };
  const handleDragLeave = (event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) openFile(file);
  };

  return (
    <div className="app">
      <aside className="panel">
        {bundle ? (
          <ScenePanel bundle={bundle} />
        ) : (
          <section>
            <p className="eyebrow">Scene</p>
            <h1>{sceneId}</h1>
            {error ? <p className="error">Could not load scene: {error}</p> : <p className="muted">Loading…</p>}
          </section>
        )}
        <SplatPanel
          state={splat.state}
          onOpenFile={openFile}
          onRotate={() => sceneRoot?.rotateSplat90()}
          onFrame={() => sceneRoot?.frameSplat()}
          onClear={splat.clear}
        />
      </aside>
      <main className="stage" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <ViewerCanvas onReady={setSceneRoot} onHover={setHover} />
        {hover && (
          <div className="readout">
            x {hover.x.toFixed(1)} m E · y {hover.y.toFixed(1)} m N · elevation {hover.z.toFixed(2)} m
          </div>
        )}
        {dragging && <div className="drop-overlay">Drop a {SPLAT_EXTENSIONS.join(" / ")} splat to preview it</div>}
      </main>
      <BasecampPanel basecamp={basecamp} />
    </div>
  );
}
