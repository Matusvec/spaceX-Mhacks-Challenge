import type { ModuleType } from "../contracts";
import { API_BASE, apiFetch, hasApi } from "../config/backend";

// One saved Grok Imagine render, as the backend's POST /concept and GET /concepts return it.
export type ConceptRender = {
  id: string;
  scene_id: string;
  created_at: string;
  model: string;
  mode: "edit" | "generate"; // "edit": made from the user's view. "generate": text only, not this terrain.
  note: string | null;
  prompt: string; // the exact text sent to Grok Imagine
  idea: string;
  image_url: string; // path on the backend, or a data URL from the deployed build (which has no disk)
  view_url: string | null; // the 3D view that was sent
};

export type ConceptModule = { type: ModuleType; x: number; y: number };

export const hasBackend = hasApi;

/** Full URL of a file the backend serves (for example a saved render). */
export function backendUrl(path: string): string {
  return path.startsWith("data:") ? path : `${API_BASE}${path}`;
}

/** The backend's own error message for a failed response ("XAI_API_KEY is not set in apps/backend/.env"). */
export async function backendError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `${response.status} ${response.statusText}`;
}

/** Asks the backend for a Grok Imagine render of `image` (a data URL of the current view). Throws with a readable message. */
export async function requestConcept(body: {
  scene_id: string;
  prompt: string;
  image: string | null;
  modules: ConceptModule[];
}): Promise<ConceptRender> {
  const response = await apiFetch("/concept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await backendError(response));
  return (await response.json()) as ConceptRender;
}

/** The last few saved renders for a scene, newest first. */
export async function listConcepts(sceneId: string): Promise<ConceptRender[]> {
  const response = await apiFetch(`/concepts?scene_id=${encodeURIComponent(sceneId)}`);
  if (!response.ok) throw new Error(await backendError(response));
  return (await response.json()) as ConceptRender[];
}

/** A canvas as a JPEG data URL, scaled down so its longer side is at most `maxSide` pixels. */
export function canvasToJpeg(canvas: HTMLCanvasElement, maxSide = 1536): string {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const small = document.createElement("canvas");
  small.width = Math.round(canvas.width * scale);
  small.height = Math.round(canvas.height * scale);
  small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
  const jpeg = small.toDataURL("image/jpeg", 0.88);
  // A serverless function accepts at most 4.5 MB per request: a view that is still large is sent smaller.
  return jpeg.length > 3_000_000 && maxSide > 512 ? canvasToJpeg(canvas, Math.round(maxSide / 1.5)) : jpeg;
}
