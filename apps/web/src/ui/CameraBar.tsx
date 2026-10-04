import { useEffect, useState } from "react";
import type { CameraMode } from "../scene/cameraRig";
import type { SceneRoot } from "../scene/SceneRoot";

const MODES: { mode: CameraMode; label: string; title: string }[] = [
  { mode: "free", label: "Free", title: "Drag to look around, scroll to zoom, keys to fly" },
  { mode: "follow", label: "Follow rover", title: "The camera rides along with the rover; drag to orbit it" },
  { mode: "rover", label: "Rover camera", title: "The view from the rover's mast camera" },
];

// Camera mode buttons over the 3D view.
export function CameraBar({ sceneRoot }: { sceneRoot: SceneRoot | null }) {
  const [mode, setMode] = useState<CameraMode>("free");

  useEffect(() => sceneRoot?.setCameraMode(mode), [sceneRoot, mode]);

  return (
    <div className="camera-bar">
      <div className="buttons">
        {MODES.map((m) => (
          <button key={m.mode} className={m.mode === mode ? "active" : ""} title={m.title} onClick={() => setMode(m.mode)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === "free" && <p className="muted small">W A S D to fly · Q / E down / up · Shift faster</p>}
    </div>
  );
}
