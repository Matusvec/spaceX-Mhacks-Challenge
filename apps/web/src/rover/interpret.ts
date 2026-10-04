import type { Intent } from "../contracts";
import { interpretLocally } from "./localInterpreter";

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

export type Interpretation = { intent: Intent | null; via: "grok" | "local" };

// Text to one intent: the backend's /intent (Grok) when configured, else the local keyword reader.
export async function interpret(text: string, sceneId: string, pinNames: string[]): Promise<Interpretation> {
  if (BACKEND_URL) {
    try {
      const response = await fetch(`${BACKEND_URL}/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, scene_id: sceneId, context: { pins: pinNames } }),
      });
      if (response.ok) return { intent: (await response.json()) as Intent, via: "grok" };
    } catch {
      // Backend unreachable: fall through to the local reader so the demo keeps working.
    }
  }
  return { intent: interpretLocally(text), via: "local" };
}
