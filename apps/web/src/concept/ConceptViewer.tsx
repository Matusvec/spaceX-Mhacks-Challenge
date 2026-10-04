import { useEffect } from "react";
import { createPortal } from "react-dom";
import { backendUrl, type ConceptRender } from "./api";
import { showInViewer, useConceptPoses } from "./conceptPoses";

/** Full-window comparison: the 3D view that was sent, beside the Grok Imagine render made from it. */
export function ConceptViewer({ render, onClose }: { render: ConceptRender; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fromView = render.mode === "edit" && render.view_url !== null;
  const hasPose = useConceptPoses().poses[render.id] !== undefined; // taken in this browser: can go back into the 3D view

  return createPortal(
    <div className="concept-viewer" role="dialog" aria-label="Concept render" onClick={onClose}>
      <div className="concept-viewer-body" onClick={(e) => e.stopPropagation()}>
        <div className="concept-viewer-head">
          <strong>AI concept render by Grok Imagine. Not data.</strong>
          <span className="buttons">
            {hasPose && (
              <button
                onClick={() => {
                  onClose();
                  showInViewer(render.id);
                }}
              >
                Show in viewer
              </button>
            )}
            <button onClick={onClose}>Close (Esc)</button>
          </span>
        </div>
        <div className={`concept-compare${render.view_url ? "" : " single"}`}>
          {render.view_url && (
            <figure>
              <img src={backendUrl(render.view_url)} alt="The 3D view that was sent to Grok Imagine" />
              <figcaption>Your 3D view of the scene, as sent</figcaption>
            </figure>
          )}
          <figure className="concept-ai">
            <img src={backendUrl(render.image_url)} alt="AI concept render by Grok Imagine" />
            <figcaption>
              AI concept render by Grok Imagine ({render.model}). Not data.
              {!fromView && " Made from text only, so it does not show your view."}
            </figcaption>
          </figure>
        </div>
        {render.note && <p className="error small">{render.note}</p>}
        <p className="concept-prompt small">
          <span className="muted">Prompt sent: </span>
          {render.prompt}
        </p>
      </div>
    </div>,
    document.body,
  );
}
