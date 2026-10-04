import { useSyncExternalStore } from "react";
import type { CameraPose } from "../scene/cameraPose";

// What this browser remembers about each concept render, by render id: the camera pose it was taken
// from, and whether it is pinned to its site. The picture itself stays in the gallery; only small
// data lives here. Local to this browser, not shared.
export type ConceptPose = { pose: CameraPose; sceneId: string; idea: string; createdAt: string; pinned: boolean };

type State = { poses: Record<string, ConceptPose>; viewId: string | null };

const KEY = "pss-concept-poses";

function load(): Record<string, ConceptPose> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, ConceptPose>;
  } catch {
    return {};
  }
}

let state: State = { poses: load(), viewId: null };
const listeners = new Set<() => void>();

function set(next: State): void {
  if (next.poses !== state.poses) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next.poses));
    } catch {
      // Storage full or blocked: the poses last until reload.
    }
  }
  state = next;
  listeners.forEach((listener) => listener());
}

export function useConceptPoses(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function rememberPose(id: string, entry: ConceptPose): void {
  set({ ...state, poses: { ...state.poses, [id]: entry } });
}

export function setPinned(id: string, pinned: boolean): void {
  const entry = state.poses[id];
  if (entry) set({ ...state, poses: { ...state.poses, [id]: { ...entry, pinned } } });
}

/** Opens the in-viewer concept view for a render (it needs a remembered pose), or closes it with null. */
export function showInViewer(id: string | null): void {
  set({ ...state, viewId: id });
}

export function conceptName(entry: { idea: string; createdAt: string }): string {
  const time = new Date(entry.createdAt);
  const stamp = Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return entry.idea.trim() || `Base on this view${stamp ? `, ${stamp}` : ""}`;
}
