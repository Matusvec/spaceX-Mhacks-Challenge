import { conceptName, setPinned, showInViewer, useConceptPoses } from "./conceptPoses";
import type { Concept } from "./useConcept";

/** "Concepts": the renders this browser can put back into the viewer, pinned ones first. */
export function ConceptList({ concept }: { concept: Concept }) {
  const { poses, viewId } = useConceptPoses();
  const sceneId = concept.renders[0]?.scene_id;
  const inGallery = new Set(concept.renders.map((r) => r.id));
  const rows = Object.entries(poses)
    .filter(([id, entry]) => entry.sceneId === sceneId && (entry.pinned || inGallery.has(id)))
    .sort(([, a], [, b]) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  if (rows.length === 0) return null;

  return (
    <>
      <h2>Concepts</h2>
      <ul className="concept-list small">
        {rows.map(([id, entry]) => (
          <li key={id}>
            <span className={entry.pinned ? "concept-pin-dot" : "concept-pin-dot off"} title={entry.pinned ? "Pinned to its site" : "Not pinned"} />
            {conceptName(entry)}
            <div className="buttons">
              <button className={id === viewId ? "active" : ""} disabled={!inGallery.has(id)} onClick={() => showInViewer(id)}>
                Show in viewer
              </button>
              <button onClick={() => setPinned(id, !entry.pinned)}>{entry.pinned ? "Unpin" : "Pin to site"}</button>
            </div>
            {!inGallery.has(id) && <span className="muted">Its picture is no longer in the gallery.</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
