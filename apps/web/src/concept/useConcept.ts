import { useCallback, useEffect, useRef, useState } from "react";
import type { ModuleType, SceneManifest } from "../contracts";
import type { SceneRoot } from "../scene/SceneRoot";
import { SAME_ORIGIN } from "../config/backend";
import { canvasToJpeg, hasBackend, listConcepts, requestConcept, type ConceptRender } from "./api";
import { loadGallery, saveGallery } from "./localGallery";

const GALLERY_SIZE = 8;

type Placement = { type: ModuleType; x: number; y: number } | null;

/**
 * Concept renders by Grok Imagine: captures the current 3D view, sends it to the backend's /concept and keeps
 * the last few results. One instance is shared by the "Where to build" panel and the chat's render_concept intent.
 */
export function useConcept(sceneRoot: SceneRoot | null, manifest: SceneManifest | null, placement: Placement) {
  const sceneId = manifest?.scene_id ?? null;
  const [renders, setRenders] = useState<ConceptRender[]>([]);
  const [idea, setIdea] = useState("");
  const [busySince, setBusySince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // The chat calls render() from an older closure, so it reads the latest values through this ref.
  const latest = useRef({ sceneRoot, sceneId, placement, idea, busy: false });
  latest.current = { sceneRoot, sceneId, placement, idea, busy: busySince !== null };

  useEffect(() => {
    setRenders([]);
    setOpenId(null);
    setError(null);
    if (!sceneId || !hasBackend) return;
    if (SAME_ORIGIN) return setRenders(loadGallery(sceneId)); // deployed build: the gallery lives in this browser
    let cancelled = false;
    const load = async () => {
      try {
        const saved = await listConcepts(sceneId);
        if (!cancelled) setRenders(saved);
      } catch (err) {
        if (!cancelled) setError(`Could not load earlier renders: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  const render = useCallback(async (ideaOverride?: string) => {
    const now = latest.current;
    if (!now.sceneRoot || !now.sceneId || now.busy) return;
    if (ideaOverride !== undefined) setIdea(ideaOverride);
    setError(null);
    setBusySince(Date.now());
    try {
      const view = canvasToJpeg(now.sceneRoot.captureView());
      const sceneId = now.sceneId;
      const answer = await requestConcept({
        scene_id: sceneId,
        prompt: (ideaOverride ?? now.idea).trim().slice(0, 400),
        image: view,
        modules: now.placement ? [{ type: now.placement.type, x: now.placement.x, y: now.placement.y }] : [],
      });
      // The deployed build saves nothing on the server, so this browser keeps the view it sent and the gallery.
      const done = SAME_ORIGIN ? { ...answer, view_url: answer.view_url ?? view } : answer;
      setRenders((old) => {
        const next = [done, ...old].slice(0, GALLERY_SIZE);
        if (SAME_ORIGIN) saveGallery(sceneId, next);
        return next;
      });
      setOpenId(done.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message === "Failed to fetch" ? "Could not reach the backend." : message);
    } finally {
      setBusySince(null);
    }
  }, []);

  // Multiplayer (multiplayer/useSharedConcepts.ts): a teammate's shared render joins this session's list.
  // It is not saved to this browser's gallery; it comes back from the shared table on the next visit.
  const adopt = useCallback((render: ConceptRender) => setRenders((old) => (old.some((r) => r.id === render.id) ? old : [...old, render])), []);

  return {
    adopt,
    available: hasBackend,
    ready: sceneRoot !== null && sceneId !== null,
    renders,
    idea,
    setIdea,
    busySince,
    error,
    open: renders.find((r) => r.id === openId) ?? null,
    show: setOpenId,
    render,
  };
}

export type Concept = ReturnType<typeof useConcept>;
