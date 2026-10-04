import { MODULE_LABELS, SCORING } from "../config/scoring";
import type { Intent, SceneManifest, SciencePin } from "../contracts";
import type { CandidateSite } from "../modules/siteSearch";
import type { Basecamp } from "../ui/useBasecamp";
import type { RouteTarget, Rover } from "../ui/useRover";

export type ChatReply = { text: string; sources?: { label: string; url: string }[] };

export type ExecuteContext = {
  manifest: SceneManifest;
  pins: SciencePin[];
  rover: Rover;
  basecamp: Basecamp;
  selectedTarget: RouteTarget | null;
};

export const HELP_TEXT = [
  "I can plan and drive routes, check if places are reachable, suggest base sites, and report cited science from pins. Try:",
  "• Where should we build?",
  "• Is site 2 reachable?",
  "• Drive to site 1",
  "• Go home",
  "• What minerals are here?",
].join("\n");

function findPin(text: string, pins: SciencePin[]): SciencePin | undefined {
  const t = text.toLowerCase();
  return pins.find((pin) => t.includes(pin.name.toLowerCase()) || pin.name.toLowerCase().includes(t));
}

function resolveDestination(to: string, ctx: ExecuteContext, sites: CandidateSite[]): RouteTarget | null {
  const t = to.trim().toLowerCase();
  const siteNumber = t.match(/\bsite\s*#?(\d+)/)?.[1];
  if (siteNumber) {
    const site = sites[Number(siteNumber) - 1];
    return site ? { x: site.x, y: site.y, label: `Site ${siteNumber}` } : null;
  }
  if (/\b(selected|placement|habitat|module|it|there)\b/.test(t)) return ctx.selectedTarget;
  if (/\b(home|start|origin|back)\b/.test(t)) return { x: 0, y: 0, label: "the start point" };
  const coords = t.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (coords) {
    const [x, y] = [Number(coords[1]), Number(coords[2])];
    return { x, y, label: `(${x}, ${y}) m` };
  }
  const pin = findPin(t, ctx.pins);
  return pin ? { x: pin.position_site[0], y: pin.position_site[1], label: pin.name } : null;
}

function describeRoute(intent: Extract<Intent, { intent: "show_path" }>, ctx: ExecuteContext): ChatReply {
  const { rover, basecamp } = ctx;
  if (rover.route?.status === "driving") return { text: "I'm still driving. Ask me again when I arrive." };
  const target = resolveDestination(intent.args.to, ctx, basecamp.topSites);
  if (!target) {
    return { text: `I don't know where "${intent.args.to}" is. Try "site 2", a pin name, "home", or coordinates like (120, -40).` };
  }
  const route = intent.args.drive ? rover.driveTo(target) : rover.planRoute(target);
  if (!route?.path) {
    return { text: `No safe route to ${target.label}: every way there crosses slopes over ${SCORING.roverSlopeLimitDeg}°.` };
  }
  const summary = `${Math.round(route.path.lengthM)} m, steepest slope ${route.path.maxSlopeDeg.toFixed(1)}°`;
  return intent.args.drive
    ? { text: `Driving to ${target.label}: ${summary}. Playback is sped up.` }
    : { text: `Yes, I can reach ${target.label}: ${summary}. The route is drawn in orange. Say "drive to ${target.label}" to go.` };
}

function describeSites(intent: Extract<Intent, { intent: "find_sites" }>, ctx: ExecuteContext): ChatReply {
  const { basecamp, rover } = ctx;
  const { max_slope_deg, near_pin, within_m, terrain_class, min_carbonate } = intent.args;
  const caveats: string[] = [];
  if (terrain_class) caveats.push(`I can't filter by terrain class yet: this scene has no terrain-class layer.`);
  if (min_carbonate !== undefined) caveats.push(`I can't filter by carbonate yet: this scene has no mineral layer.`);
  const pin = near_pin ? findPin(near_pin, ctx.pins) : undefined;
  if (near_pin && !pin) caveats.push(`I couldn't find a pin called "${near_pin}".`);

  const label = MODULE_LABELS[basecamp.moduleType].toLowerCase();
  const matches = basecamp
    .findSites(20)
    .map((site) => ({ site, score: basecamp.evaluateAt(site.x, site.y) }))
    .filter(({ site, score }) => {
      if (!score) return false;
      if (max_slope_deg !== undefined && score.slopeMaxDeg > max_slope_deg) return false;
      if (pin && within_m !== undefined) {
        return Math.hypot(pin.position_site[0] - site.x, pin.position_site[1] - site.y) <= within_m;
      }
      return true;
    })
    .slice(0, 3);

  if (matches.length === 0) return { text: [`No ${label} sites match those conditions.`, ...caveats].join("\n") };
  const lines = matches.map(({ site, score }, i) => {
    const reach = rover.isReachable ? (rover.isReachable(site.x, site.y) ? "rover can reach it" : "rover can't reach it") : "";
    const science = score!.distToScienceM === null ? "" : `, ${Math.round(score!.distToScienceM)} m from the nearest pin`;
    return `${i + 1}. (${site.x.toFixed(0)}, ${site.y.toFixed(0)}) m: grade ${score!.grade}, max slope ${score!.slopeMaxDeg.toFixed(1)}°${science}${reach ? `, ${reach}` : ""}`;
  });
  return {
    text: [`Best ${label} sites, from terrain slope and flatness, distance to science, and rover access:`, ...lines, ...caveats].join(
      "\n",
    ),
  };
}

function describeScience(text: string, ctx: ExecuteContext): ChatReply {
  const mineralNote = ctx.manifest.layers
    ? "Mineral and terrain layers are in this scene's layer data (shown in the layer panel with their source and resolution)."
    : "This scene has no mineral layer yet. Orbital olivine and carbonate maps (CRISM-derived, about 18 m/px, area-level only) come in a later bundle.";

  const pin = findPin(text, ctx.pins);
  const pins = pin ? [pin] : ctx.pins;
  const measured = pins.filter((p) => p.measurements.length > 0);
  if (measured.length === 0) {
    const where = pin ? `at ${pin.name}` : "at any pin in this scene";
    return { text: `I have no cited measurements ${where} yet, so I won't guess.\n${mineralNote}` };
  }

  const lines = measured.flatMap((p) => [
    `${p.name}: ${p.summary}`,
    ...p.measurements.map((m) => `• ${m.label}: ${m.value}`),
  ]);
  const sources = measured.flatMap((p) => [
    ...p.measurements.map((m) => ({ label: `${p.name}: ${m.label}`, url: m.source_url })),
    ...p.source_urls.map((url) => ({ label: p.name, url })),
  ]);
  return { text: [...lines, mineralNote].join("\n"), sources: sources.filter((s) => s.url) };
}

function describePlacement(intent: Extract<Intent, { intent: "place_module" }>, ctx: ExecuteContext): ChatReply {
  const target = resolveDestination(intent.args.at, ctx, ctx.basecamp.topSites) ?? ctx.basecamp.topSites[0];
  if (!target) return { text: `I don't know where "${intent.args.at}" is.` };
  const score = ctx.basecamp.placeAt(intent.args.type, target.x, target.y);
  const label = "label" in target ? target.label : `(${target.x.toFixed(0)}, ${target.y.toFixed(0)}) m`;
  return { text: `Placed a ${MODULE_LABELS[intent.args.type].toLowerCase()} at ${label}. Grade ${score?.grade ?? "?"}; see the scorecard.` };
}

// Runs one intent through the same functions the UI buttons use, and describes the result.
export function executeIntent(intent: Intent | null, text: string, ctx: ExecuteContext): ChatReply {
  if (!intent) return { text: HELP_TEXT };
  switch (intent.intent) {
    case "show_path":
      return describeRoute(intent, ctx);
    case "find_sites":
      return describeSites(intent, ctx);
    case "query_scene":
      return describeScience(intent.args.text || text, ctx);
    case "place_module":
      return describePlacement(intent, ctx);
    default:
      return { text: `I understood "${intent.intent}", but that isn't available in the rover chat yet.` };
  }
}
