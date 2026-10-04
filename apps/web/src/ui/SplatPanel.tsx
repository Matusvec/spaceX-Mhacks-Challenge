import { useRef } from "react";
import { SPLAT_EXTENSIONS } from "../scene/splat";
import type { SplatState } from "./useSplatLoader";

type Props = {
  state: SplatState;
  onOpenFile: (file: File) => void;
  onRotate: () => void;
  onFrame: () => void;
  onClear: () => void;
};

export function SplatPanel({ state, onOpenFile, onRotate, onFrame, onClear }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <section>
      <h2>Gaussian splat</h2>

      {state.status === "none" && <p className="muted">No splat loaded. Drop a splat file on the view to preview it.</p>}

      {state.status === "loading" && (
        <>
          <p>Loading {state.name}…</p>
          <progress max={1} value={state.progress ?? undefined} />
        </>
      )}

      {state.status === "ready" && (
        <dl>
          <dt>File</dt>
          <dd>{state.name}</dd>
          <dt>From</dt>
          <dd>{state.origin === "bundle" ? "scene bundle" : "dropped file (preview)"}</dd>
          <dt>Gaussians</dt>
          <dd>{state.info.count.toLocaleString()}</dd>
          <dt>Size</dt>
          <dd>{state.info.sizeM.map((s) => s.toFixed(1)).join(" × ")} m</dd>
        </dl>
      )}

      {state.status === "error" && (
        <p className="error">
          Could not load {state.name}: {state.message}
        </p>
      )}

      <div className="buttons">
        <button onClick={() => fileInput.current?.click()}>Open file…</button>
        {state.status === "ready" && (
          <>
            <button onClick={onFrame}>Frame splat</button>
            <button onClick={onRotate} title="Training exports are often not upright yet">
              Rotate 90°
            </button>
            <button onClick={onClear}>Remove</button>
          </>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={SPLAT_EXTENSIONS.join(",")}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onOpenFile(file);
          event.target.value = "";
        }}
      />
    </section>
  );
}
