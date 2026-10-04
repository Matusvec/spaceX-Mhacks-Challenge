import { SAME_ORIGIN } from "../config/backend";

// Text search needs a CLIP model, which the deployed (serverless) build cannot run. That build ships the
// answers for a short list of phrases instead, computed ahead by the team's real backend
// (scripts/deploy_vercel.sh writes /search/<scene>.json), and says plainly that open search is not available.
export const PRESET_SEARCH = SAME_ORIGIN;

export type PresetAnswer = { text: string; cluster_ids: number[]; explanation: string };

const cache = new Map<string, Promise<PresetAnswer[]>>();

/** The prepared searches for a scene; an empty list when the scene has none. */
export function loadPresets(sceneId: string): Promise<PresetAnswer[]> {
  let presets = cache.get(sceneId);
  if (!presets) {
    presets = (async () => {
      try {
        const response = await fetch(`/search/${encodeURIComponent(sceneId)}.json`);
        return response.ok ? ((await response.json()) as PresetAnswer[]) : [];
      } catch {
        return [];
      }
    })();
    cache.set(sceneId, presets);
  }
  return presets;
}

/** The prepared answer for `text`, or null when it is not one of the prepared phrases. */
export async function presetAnswer(sceneId: string, text: string): Promise<PresetAnswer | null> {
  const wanted = text.trim().toLowerCase();
  return (await loadPresets(sceneId)).find((preset) => preset.text.toLowerCase() === wanted) ?? null;
}
