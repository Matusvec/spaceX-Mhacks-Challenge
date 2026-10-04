import { useEffect, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { HoverInfo, SceneRoot } from "./scene/SceneRoot";
import { bundleFileUrl, loadBundle, type LoadedBundle } from "./scene/loadBundle";
import { isSplatFileName, SPLAT_EXTENSIONS } from "./scene/splat";
import { ConceptOverlay } from "./concept/ConceptOverlay";
import { useConcept } from "./concept/useConcept";
import { MODULE_LABELS } from "./config/scoring";
import { useSharedScene, type SharedAccount } from "./multiplayer/useSharedScene";
import { useRoverBroadcast, useSharedSync } from "./multiplayer/useSharedSync";
import { useSharedConcepts } from "./multiplayer/useSharedConcepts";
import { sampleHeight } from "./scene/heightfield";
import { SharedPanel } from "./ui/SharedPanel";
import { TeamChat } from "./ui/TeamChat";
import { Shell } from "./ui/Shell";
import { BasecampPanel } from "./ui/BasecampPanel";
import { LayersPanel } from "./ui/LayersPanel";
import { RoverChat } from "./ui/RoverChat";
import { RoverPanel } from "./ui/RoverPanel";
import { ScenePanel } from "./ui/ScenePanel";
import { useBasecamp } from "./ui/useBasecamp";
import { useSiteValues } from "./ui/useSiteValues";
import { useRasterLayer } from "./ui/useRasterLayer";
import { useSplatLayer } from "./ui/useSplatLayer";
import { useRover } from "./ui/useRover";
import { SourcesDialog } from "./ui/SourcesDialog";
import { SplatLayersPanel } from "./ui/SplatLayersPanel";
import { CameraBar } from "./ui/CameraBar";
import { SplatPanel } from "./ui/SplatPanel";
import { useSplatLoader } from "./ui/useSplatLoader";
import { useTerrainAnalysis } from "./ui/useTerrainAnalysis";
import { ViewerCanvas } from "./ui/ViewerCanvas";

// Sign-in, "Your scenes" and the scene switcher are in ui/Shell.tsx (the bare URL opens that list);
// one Studio is mounted per open scene, so switching scenes starts from a clean viewer without a page reload.
export function App() {
  return <Shell>{(sceneId, account) => <Studio key={sceneId} sceneId={sceneId} account={account} />}</Shell>;
}

function Studio({ sceneId, account }: { sceneId: string; account: SharedAccount }) {
  const [bundle, setBundle] = useState<LoadedBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo>(null);
  const [sceneRoot, setSceneRoot] = useState<SceneRoot | null>(null);
  const [dragging, setDragging] = useState(false);
  const [presentation, setPresentation] = useState(true);
  const [displayedBundle, setDisplayedBundle] = useState<LoadedBundle | null>(null);
  const splat = useSplatLoader(sceneRoot);
  const { load: loadSplat, fail: failSplat } = splat;
  const analysis = useTerrainAnalysis(displayedBundle);
  const rasterLayer = useRasterLayer(sceneRoot, displayedBundle);
  const splatLayer = useSplatLayer(sceneRoot, displayedBundle, splat.state);
  // Shared session (SpacetimeDB): presence, user pins, placed modules and the rover's drives.
  const shared = useSharedScene(sceneId, account);
  const roverSync = useRoverBroadcast(shared);
  const rover = useRover(sceneRoot, analysis, roverSync);
  const siteValues = useSiteValues(displayedBundle); // Moon rasters and shielding factors for the score
  const basecamp = useBasecamp(sceneRoot, analysis, rover.isReachable, siteValues.values);
  const body = displayedBundle?.manifest.body ?? null;
  const sharedSync = useSharedSync({ shared, roverSync, sceneRoot, body, rover, basecamp, hover });
  const heightAt = (x: number, y: number) => (displayedBundle && sampleHeight(displayedBundle.heightfield, x, y)) ?? 0;
  const concept = useConcept(sceneRoot, displayedBundle?.manifest ?? null, basecamp.placement);
  useSharedConcepts(shared, concept, displayedBundle?.manifest.scene_id ?? null);
  const selectedTarget = basecamp.placement && {
    x: basecamp.placement.x,
    y: basecamp.placement.y,
    label: `${MODULE_LABELS[basecamp.placement.type].toLowerCase()} at (${basecamp.placement.x.toFixed(0)}, ${basecamp.placement.y.toFixed(0)})`,
  };

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

  useEffect(() => sceneRoot?.setPresentation(presentation), [sceneRoot, presentation]);

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

  const shellBar = document.querySelector(".shell-bar");
  const liveText = shared.status === "live" ? `live ${shared.people.length}` : shared.status === "connecting" ? "connecting" : "offline, not shared";

  return (
    <div className="app">
      <aside className="panel">
        {bundle ? (
          <ScenePanel bundle={bundle} presentation={presentation} onPresentation={setPresentation} onDrive={rover.driveTo}>
            <details className="fold" open>
              <summary>Layers · terrain and splat</summary>
              <LayersPanel layer={rasterLayer} />
              <SplatLayersPanel layer={splatLayer} />
            </details>
          </ScenePanel>
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
        {bundle && <SourcesDialog bundle={bundle} />}
      </aside>
      <main className="stage" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <ViewerCanvas onReady={setSceneRoot} onHover={setHover} />
        <CameraBar sceneRoot={sceneRoot} />
        <ConceptOverlay sceneRoot={displayedBundle && sceneRoot} concept={concept} sceneId={displayedBundle?.manifest.scene_id ?? null} heightAt={heightAt} />
        {/* Who is here, as plain text in the header bar next to the scene switcher (over the view when there is no bar). */}
        {shellBar ? (
          // Offline is already said in the header by the account status.
          shared.status !== "offline" && createPortal(<span className={`chip chip-${shared.status}`}>{liveText}</span>, shellBar)
        ) : (
          <div className={`chip chip-${shared.status} stage-chip`}>{liveText}</div>
        )}
        {hover && (
          <div className="readout">
            x {hover.x.toFixed(1)} m E · y {hover.y.toFixed(1)} m N · elevation {hover.z.toFixed(2)} m
          </div>
        )}
        <RoverChat
          context={
            displayedBundle && {
              manifest: displayedBundle.manifest,
              pins: displayedBundle.pins,
              rover,
              basecamp,
              selectedTarget,
              concept,
              sharedModules: shared.modules,
              rasters: displayedBundle.rasters,
              splatFields: displayedBundle.splatLayers?.schema.fields,
              shielding: displayedBundle.shielding,
              userPins: { pins: shared.pins, add: (x, y, note) => shared.actions.addPin({ x, y, z: heightAt(x, y) }, note) },
            }
          }
        />
        <TeamChat shared={shared} />
        {dragging && <div className="drop-overlay">Drop a {SPLAT_EXTENSIONS.join(" / ")} splat to preview it</div>}
      </main>
      <aside className="panel panel-right">
        <BasecampPanel basecamp={basecamp} concept={concept} />
        <details className="fold single" open>
          <summary>Rover · drive and routes</summary>
          <RoverPanel rover={rover} selectedTarget={selectedTarget} />
        </details>
        <details className="fold single" open>
          <summary>People · pins and modules</summary>
          <SharedPanel
            shared={shared}
            sceneRoot={displayedBundle && sceneRoot}
            heightAt={heightAt}
            onDrive={rover.driveTo}
            driving={rover.route?.status === "driving"}
            basecampPlacing={basecamp.placing}
            onBeginPick={() => basecamp.setPlacing(false)}
            editingModuleId={sharedSync.editingId}
            onKeepModule={sharedSync.keepModule}
          />
        </details>
      </aside>
    </div>
  );
}
