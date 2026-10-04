import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { SceneRoot } from "../scene/SceneRoot";
import { backendUrl } from "./api";
import { createConceptPins, disposeConceptPins } from "./conceptPins";
import { conceptName, rememberPose, setPinned, showInViewer, useConceptPoses } from "./conceptPoses";
import type { Concept } from "./useConcept";

type Props = { sceneRoot: SceneRoot | null; concept: Concept; sceneId: string | null; heightAt: (x: number, y: number) => number };

/**
 * The concept view inside the 3D viewer: the camera goes back to where a render was taken from and Grok's
 * picture is laid over the live scene, with a divider to drag between the two. Sits over the stage.
 */
export function ConceptOverlay({ sceneRoot, concept, sceneId, heightAt }: Props) {
  const { poses, viewId } = useConceptPoses();
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [split, setSplit] = useState(0.5); // share of the width showing the live scene, from the left
  const knownIds = useRef<Set<string> | null>(null);
  const heightRef = useRef(heightAt);
  heightRef.current = heightAt;

  // A render that has just arrived: remember where it was taken from and open it here, not in the compare window.
  useLayoutEffect(() => {
    const ids = new Set(concept.renders.map((r) => r.id));
    const newest = concept.renders[0];
    const pose = sceneRoot?.lastCapturedPose();
    const fresh = knownIds.current !== null && newest && !knownIds.current.has(newest.id) && concept.open?.id === newest.id;
    knownIds.current = ids;
    if (!fresh || !pose || newest.mode !== "edit") return;
    rememberPose(newest.id, { pose, sceneId: newest.scene_id, idea: newest.idea, createdAt: newest.created_at, pinned: false });
    setSplit(0.5);
    showInViewer(newest.id);
    concept.show(null);
  }, [concept, sceneRoot]);

  const entry = viewId ? poses[viewId] : undefined;
  const render = concept.renders.find((r) => r.id === viewId);
  const active = Boolean(sceneRoot && entry && render && entry.sceneId === sceneId);

  useEffect(() => {
    if (!active || !sceneRoot || !entry) return;
    sceneRoot.holdPose(entry.pose);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && showInViewer(null);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      sceneRoot.holdPose(null);
    };
  }, [active, sceneRoot, entry]);

  // Leaving the scene closes the view.
  useEffect(() => () => showInViewer(null), [sceneId]);

  // Markers for the concepts pinned in this scene.
  useEffect(() => {
    if (!sceneRoot || !sceneId) return;
    const pins = createConceptPins(Object.values(poses).filter((p) => p.pinned && p.sceneId === sceneId), heightRef.current);
    const remove = sceneRoot.addSiteLayer(pins);
    return () => {
      remove();
      disposeConceptPins(pins);
    };
  }, [sceneRoot, sceneId, poses]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize([element.clientWidth, element.clientHeight]));
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  if (!active || !entry || !render || !viewId) return null;

  // The picture keeps the aspect of the view it was made from; SceneRoot fits the camera to match.
  const [width, height] = size;
  const boxWidth = Math.min(width, height * entry.pose.aspect);
  const boxHeight = boxWidth / entry.pose.aspect;
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1 && event.type !== "pointerdown") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = event.currentTarget.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)));
  };

  return (
    <div className="concept-overlay" ref={frame}>
      <div className="concept-box" style={{ width: boxWidth, height: boxHeight }} onPointerDown={drag} onPointerMove={drag}>
        <img
          src={backendUrl(render.image_url)}
          alt={`AI concept render: ${conceptName(entry)}`}
          style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}
          draggable={false}
        />
        <div className="concept-divider" style={{ left: `${split * 100}%` }}>
          <span>⇔</span>
        </div>
        <span className="concept-side concept-side-live">Live 3D scene</span>
        <span className="concept-side concept-side-ai">AI concept render by Grok Imagine. Not data.</span>
      </div>
      <div className="concept-bar">
        <strong>{conceptName(entry)}</strong>
        <span className="muted small">Drag the divider · camera locked</span>
        <button onClick={() => setPinned(viewId, !entry.pinned)}>{entry.pinned ? "Unpin from site" : "Pin to site"}</button>
        <button
          onClick={() => {
            showInViewer(null);
            concept.show(viewId);
          }}
        >
          Compare
        </button>
        <button className="concept-exit" onClick={() => showInViewer(null)}>
          Exit concept view
        </button>
      </div>
    </div>
  );
}
