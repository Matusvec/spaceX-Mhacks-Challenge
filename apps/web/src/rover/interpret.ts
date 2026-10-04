import { backendError } from "../concept/api";
import { apiFetch, hasApi } from "../config/backend";
import type { Intent } from "../contracts";
import { interpretLocally } from "./localInterpreter";

// `why` says why Grok did not answer, when the local reader was used instead.
export type Interpretation = { intent: Intent | null; via: "grok" | "local"; why?: string };

// Text to one intent: the backend's /intent (Grok) when configured, else the local keyword reader.
export async function interpret(text: string, sceneId: string, pinNames: string[]): Promise<Interpretation> {
  let why = "no backend configured";
  if (hasApi) {
    try {
      const response = await apiFetch("/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, scene_id: sceneId, context: { pins: pinNames } }),
      });
      if (response.ok) return { intent: (await response.json()) as Intent, via: "grok" };
      why = await backendError(response);
    } catch {
      // Backend unreachable: fall through to the local reader so the demo keeps working.
      why = "backend unreachable";
    }
  }
  return { intent: interpretLocally(text), via: "local", why };
}
