import type { Intent } from "../contracts";

// A small keyword reader that turns common rover requests into contract intents, so the chat
// works without the backend. The backend's /intent (Grok) replaces it when VITE_BACKEND_URL is set.
// Returns null for "help" or anything it does not recognize.
export function interpretLocally(text: string): Intent | null {
  const t = text.trim().toLowerCase();
  if (!t || /\b(help|what can you do|commands)\b/.test(t)) return null;

  if (/\b(render|picture|image|concept|visuali[sz]e|imagine|look like|draw)\b/.test(t)) {
    return { intent: "render_concept", args: {} };
  }

  if (/\b(bury|buried|underground|regolith|cover (it|the)|tunnel (it|this))\b/.test(t)) {
    const depth = t.match(/(\d+(?:\.\d+)?)\s*(cm|centimet|m\b|met)/);
    return { intent: "set_cover", args: depth ? { depth_m: Number(depth[1]) * (depth[2].startsWith("c") ? 0.01 : 1) } : {} };
  }

  const destination =
    t.match(/\b(?:to|reach|get to|at)\s+(.+?)[?.!]*$/)?.[1] ??
    t.match(/\b(?:is|are)\s+(.+?)\s+reachable/)?.[1] ??
    t.match(/\b(home|back|start)\b/)?.[1];

  if (/\b(drive|go|move|head|navigate|roll|send|return)\b/.test(t) && destination) {
    return { intent: "show_path", args: { from: "rover", to: destination, drive: true } };
  }
  if (/\b(reach|reachable|route|path|get to|can (?:the rover|you|it) go)\b/.test(t) && destination) {
    return { intent: "show_path", args: { from: "rover", to: destination } };
  }
  if (/\b(where|best|good|recommend|suggest)\b.*\b(site|spot|place|build|camp|base|land)\b/.test(t)) {
    return { intent: "find_sites", args: {} };
  }
  if (/\b(mineral|chemistry|composition|carbonate|olivine|organic|sample|found|find|discover|detect|analy|rock|science|measure)/.test(t)) {
    return { intent: "query_scene", args: { text: text.trim() } };
  }
  if (/\b(place|put|build)\b/.test(t)) {
    const type = /dome|greenhouse/.test(t)
      ? "greenhouse_dome"
      : /pad|landing/.test(t)
        ? "landing_pad"
        : /solar|panel/.test(t)
          ? "solar_field"
          : "habitat";
    return { intent: "place_module", args: { type, at: destination ?? "selected_site" } };
  }
  return null;
}
