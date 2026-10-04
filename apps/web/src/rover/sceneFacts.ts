import { MODULE_LABELS } from "../config/scoring";
import type { ExecuteContext } from "./executeIntent";

const MAX_CHARS = 7500; // the backend accepts 8000

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
  basecamp.topSites.forEach((site, i) =>
    lines.push(
      `Best ${MODULE_LABELS[basecamp.moduleType].toLowerCase()} site ${i + 1}: (${site.x.toFixed(0)}, ${site.y.toFixed(0)}) m, grade ${Math.round(site.grade)} of 100 (computed by the app from slope, flatness, distance to science and rover access).`,
    ),
  );
  const placed = basecamp.placement;
  lines.push(
    placed
      ? `Placed module: ${MODULE_LABELS[placed.type].toLowerCase()} at (${placed.x.toFixed(0)}, ${placed.y.toFixed(0)}) m${basecamp.evaluation ? `, grade ${basecamp.evaluation.score.grade} of 100, max slope ${basecamp.evaluation.score.slopeMaxDeg.toFixed(1)} degrees` : ""}.`
      : "No module is placed yet.",
  );
  lines.push("Coordinates are meters east and north of the site origin.");
  return lines.join("\n").slice(0, MAX_CHARS);
}
