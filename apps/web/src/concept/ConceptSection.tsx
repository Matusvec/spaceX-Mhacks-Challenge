import { useEffect, useState } from "react";
import { TeamCodeField } from "../rover/TeamCodeField";
import { backendUrl } from "./api";
import { ConceptList } from "./ConceptList";
import { ConceptViewer } from "./ConceptViewer";
import type { Concept } from "./useConcept";
import "./concept.css";

function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.round((now - since) / 1000));
}

/** The "Concept render" block of the "Where to build" panel: idea box, button, progress, errors and gallery. */
export function ConceptSection({ concept }: { concept: Concept }) {
  const busy = concept.busySince !== null;
  const seconds = useElapsedSeconds(concept.busySince);

  return (
    <>
      <h2>Concept render</h2>
      <TeamCodeField />
      <label className="field">
        Base idea (optional)
        <textarea
          className="concept-idea"
          rows={2}
          maxLength={400}
          value={concept.idea}
          onChange={(e) => concept.setIdea(e.target.value)}
          placeholder="three domes linked by tunnels, solar field to the south"
          disabled={busy}
        />
      </label>
      <div className="buttons">
        <button
          className="concept-go"
          onClick={() => void concept.render()}
          disabled={busy || !concept.ready || !concept.available}
        >
          {busy ? "Rendering…" : "Concept render"}
        </button>
      </div>
      {busy && (
        <p className="concept-progress small" role="status">
          <span className="concept-spinner" /> Grok Imagine is drawing the base on your current view… {seconds} s
        </p>
      )}
      {concept.error && (
        <p className="error small" role="alert">
          {concept.error}
        </p>
      )}
      {!concept.available && <p className="muted small">Needs the backend: set VITE_BACKEND_URL and restart the web app.</p>}
      {concept.renders.length > 0 && (
        <div className="concept-gallery">
          {concept.renders.map((render) => (
            <button key={render.id} onClick={() => concept.show(render.id)} title={render.idea || render.prompt}>
              <img src={backendUrl(render.image_url)} alt={`AI concept render: ${render.idea || "base on this view"}`} />
            </button>
          ))}
        </div>
      )}
      <p className="muted small">
        Sends your current view to Grok Imagine (xAI), which paints a base onto it. AI concept picture, not data.
      </p>
      <ConceptList concept={concept} />
      {concept.open && <ConceptViewer render={concept.open} onClose={() => concept.show(null)} />}
    </>
  );
}
