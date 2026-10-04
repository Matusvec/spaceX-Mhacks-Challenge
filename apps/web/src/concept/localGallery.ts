import type { ConceptRender } from "./api";

// The deployed build has no server disk, so the gallery of concept renders lives in this browser.
// Pictures are stored as data URLs; localStorage holds about 5 MB, so the oldest renders are dropped to fit.
const MAX_CHARS = 3_500_000;
const key = (sceneId: string) => `pss-concepts:${sceneId}`;

export function loadGallery(sceneId: string): ConceptRender[] {
  try {
    return JSON.parse(window.localStorage.getItem(key(sceneId)) ?? "[]") as ConceptRender[];
  } catch {
    return [];
  }
}

/** Saves the newest renders that fit. Never throws: when storage is full or blocked the gallery just lasts until reload. */
export function saveGallery(sceneId: string, renders: ConceptRender[]): void {
  for (let keep = renders.length; keep >= 0; keep--) {
    const json = JSON.stringify(renders.slice(0, keep));
    if (json.length > MAX_CHARS && keep > 0) continue;
    try {
      window.localStorage.setItem(key(sceneId), json);
      return;
    } catch {
      // Quota exceeded: try again with one render fewer.
    }
  }
}
