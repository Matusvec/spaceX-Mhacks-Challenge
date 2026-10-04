import { MODULE_LABELS } from "../config/scoring";
import type { Score } from "../contracts";
import type { ExecuteContext } from "./executeIntent";

// The scorecard values a module was placed with, as one line. Only values the app computed; nothing is added.
function scoreLine(score: Partial<Score>): string {
  const parts = [
    score.grade !== undefined && `grade ${Math.round(score.grade)} of 100`,
    score.slopeMeanDeg !== undefined && `mean slope ${score.slopeMeanDeg.toFixed(1)} degrees`,
    score.slopeMaxDeg !== undefined && `max slope ${score.slopeMaxDeg.toFixed(1)} degrees`,
    score.flatnessM !== undefined && `flatness ${score.flatnessM.toFixed(2)} m (height spread under the footprint)`,
    score.cutFillM3 !== undefined && `ground to move ${Math.round(score.cutFillM3)} cubic meters`,
    score.distToScienceM != null && `${Math.round(score.distToScienceM)} m from the nearest science pin`,
    score.roverReachable != null && (score.roverReachable ? "rover can reach it" : "rover cannot reach it"),
    score.illuminationPct !== undefined && `sunlight ${Math.round(score.illuminationPct)} percent of the time`,
    score.earthVisiblePct !== undefined && `Earth visible ${Math.round(score.earthVisiblePct)} percent of the time`,
    score.doseEstimate_mSvPerYear !== undefined && `radiation dose estimate ${Math.round(score.doseEstimate_mSvPerYear)} mSv per year (an estimate)`,
    score.notes?.length && `penalties: ${score.notes.join("; ")}`,
  ];
  return parts.filter(Boolean).join(", ");
}

function parseScore(json: string): Partial<Score> {
  try {
    return JSON.parse(json) as Partial<Score>;
  } catch {
    return {};
  }
}

const MAX_CHARS = 15000; // the backend accepts 16000

/**
 * What the viewer has loaded about this scene, as plain text for Grok. Everything here comes from the scene
 * bundle or from the app's own state; Grok is told to make scientific and numeric claims only from this text.
 */
export function sceneFacts(ctx: ExecuteContext): string {
  const { manifest, pins, rover, basecamp } = ctx;
  const [width, depth] = manifest.terrain.size_m;
  const lines = [
    `Body: ${manifest.body}. Site: ${manifest.title}.`,
    `Terrain window: ${width} m by ${depth} m at ${manifest.terrain.resolution_m} m per pixel; elevation from ${manifest.terrain.z_min_m} m to ${manifest.terrain.z_max_m} m relative to the site origin.`,
    manifest.splat
      ? `A Gaussian splat of the ground near the rover, built from rover photos (${manifest.splat.count.toLocaleString()} Gaussians).`
      : "No Gaussian splat in this scene.",
    `Data in this scene: ${[manifest.layers && "per-Gaussian splat layers", manifest.rasters && "orbital raster layers", manifest.shielding && "radiation shielding estimates"].filter(Boolean).join(", ") || "terrain only"}.`,
    `Sources: ${manifest.sources.map((source) => source.name).join("; ")}.`,
  ];
  for (const pin of pins) {
    const [x, y] = pin.position_site;
    lines.push(`Science pin "${pin.name}" at (${x.toFixed(0)}, ${y.toFixed(0)}) m: ${pin.summary}`);
    if (pin.sample) lines.push(`  Sample: ${pin.sample.name} (no. ${pin.sample.number}).`);
    for (const measurement of pin.measurements) lines.push(`  Cited measurement: ${measurement.label}: ${measurement.value}`);
  }
  if (pins.length === 0) lines.push("No science pins, so no cited measurements in this scene.");
  const position = rover.position;
  if (position) lines.push(`Rover: at (${position.x.toFixed(0)}, ${position.y.toFixed(0)}) m.`);
  if (rover.route) {
    const { target, path, status } = rover.route;
    lines.push(
      `Rover route to ${target.label}: ${status}${path ? `, ${Math.round(path.lengthM)} m long, steepest slope ${path.maxSlopeDeg.toFixed(1)} degrees` : ""}.`,
    );
  }
  basecamp.topSites.forEach((site, i) => {
    // The same scorecard the app shows for a module at that spot (on the Moon it includes sunlight, Earth view, dose).
    const score = basecamp.evaluateAt(site.x, site.y);
    lines.push(
      `Best ${MODULE_LABELS[basecamp.moduleType].toLowerCase()} site ${i + 1}: (${site.x.toFixed(0)}, ${site.y.toFixed(0)}) m, ${score ? scoreLine(score) : `grade ${Math.round(site.grade)} of 100`} (computed by the app).`,
    );
  });
  if (ctx.shielding) {
    lines.push(
      `Radiation shielding by regolith depth (dose factor relative to no cover; ${ctx.shielding.source.citation}): ` +
        ctx.shielding.points.map((point) => `${point.depth_m} m: factor ${point.factor}`).join("; ") +
        `. Values between these points are this app's linear interpolation, and there is no data beyond the deepest point. ${ctx.shielding.limits}`,
    );
  }
  for (const raster of ctx.rasters ?? []) {
    lines.push(
      `Terrain layer "${raster.name}" (${raster.unit || "no unit"}; ${raster.source}, ${raster.resolution}${raster.estimate ? "; an estimate" : ""})${raster.description ? `: ${raster.description}` : ""}`,
    );
  }
  for (const field of ctx.splatFields ?? []) {
    lines.push(`Splat layer "${field.name}"${field.unit ? ` (${field.unit})` : ""}${field.source ? `: ${field.source}` : ""}${field.resolution ? `, ${field.resolution}` : ""}`);
  }
  const placed = basecamp.placement;
  lines.push(
    placed
      ? `The user's module being placed now: ${MODULE_LABELS[placed.type].toLowerCase()} at (${placed.x.toFixed(0)}, ${placed.y.toFixed(0)}) m${basecamp.evaluation ? `: ${scoreLine(basecamp.evaluation.score)}` : ""}.`
      : "The user is not placing a module right now.",
  );
  // Everything built in the shared session, by everyone, with the score each module was placed with.
  const modules = ctx.sharedModules ?? [];
  lines.push(modules.length ? `Modules built in the shared session (${modules.length}):` : "Nobody has built a module in the shared session yet.");
  modules.forEach((module, i) => {
    const who = module.mine ? `${module.authorName} (the user you are talking to)` : module.authorName;
    const score = scoreLine(parseScore(module.scoreJson));
    lines.push(
      `  ${i + 1}. ${MODULE_LABELS[module.type].toLowerCase()} by ${who} at (${module.position.x.toFixed(0)}, ${module.position.y.toFixed(0)}) m${score ? `: ${score}` : ": no score recorded"}.`,
    );
  });
  lines.push("Coordinates are meters east and north of the site origin.");
  return lines.join("\n").slice(0, MAX_CHARS);
}
