import { useEffect, useRef } from "react";
import type { ConceptRender } from "../concept/api";
import { backendUrl } from "../concept/api";
import { rememberPose, useConceptPoses } from "../concept/conceptPoses";
import type { Concept } from "../concept/useConcept";
import type { CameraPose } from "../scene/cameraPose";
import type { SharedScene } from "./useSharedScene";

const MAX_CHARS = 380_000; // the module refuses pictures over 400,000 characters
const FRESH_MS = 120_000;

// Re-encodes a render as a JPEG data URL small enough to travel in a table row.
async function shrink(url: string): Promise<string> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  for (const [width, quality] of [[1024, 0.75], [768, 0.7], [512, 0.6]] as const) {
    const scale = Math.min(1, width / image.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= MAX_CHARS) return data;
  }
  throw new Error("the render is too large to share");
}

/**
 * Shared concepts: a render made here while live is shared with the scene automatically (picture, idea and
 * camera pose in one SpacetimeDB row); renders teammates shared show up in this browser's Concepts list,
 * pinned at the spot they look at, and open in the viewer from the same pose.
 */
export function useSharedConcepts(shared: SharedScene, concept: Concept, sceneId: string | null): void {
  const { poses } = useConceptPoses();
  const { concepts, actions, status } = shared;
  const { adopt, renders } = concept;

  // In: every shared concept this browser does not already hold as its own render.
  useEffect(() => {
    if (!sceneId) return;
    for (const row of concepts) {
      const id = `shared-${row.id}`;
      if (renders.some((r) => r.id === row.renderId || r.id === id)) continue;
      const createdAt = new Date(row.createdAtMs).toISOString();
      const idea = `${row.idea.trim() || "Base on this view"} · by ${row.authorName}`;
      try {
        const pose = JSON.parse(row.poseJson) as CameraPose;
        rememberPose(id, { pose, sceneId, idea, createdAt, pinned: true });
      } catch {
        continue; // a row without a usable pose cannot be shown in the viewer
      }
      const render: ConceptRender = { id, scene_id: sceneId, created_at: createdAt, model: "shared", mode: "edit", note: null, prompt: row.prompt, idea, image_url: row.image, view_url: null };
      adopt(render);
    }
  }, [concepts, renders, adopt, sceneId]);

  // Out: renders made just now (not the older ones this browser's gallery loads when a scene opens).
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (status !== "live") return;
    for (const render of renders) {
      const entry = poses[render.id];
      const justMade = Date.now() - Date.parse(render.created_at) < FRESH_MS;
      if (!justMade || sent.current.has(render.id) || render.id.startsWith("shared-") || !entry) continue;
      sent.current.add(render.id);
      void (async () => {
        try {
          const image = await shrink(backendUrl(render.image_url));
          actions.shareConcept({ renderId: render.id, idea: render.idea, prompt: render.prompt, poseJson: JSON.stringify(entry.pose), image });
        } catch (err) {
          console.warn("could not share the concept render:", err);
        }
      })();
    }
  }, [renders, poses, status, actions]);
}
