import * as THREE from "three";
import type { LayerField, LayerSchema } from "../contracts";
import { classColorHex, HIGHLIGHT_HEX, hexToRgb, writeRampRgb } from "./colorRamp";

export type SplatLayerLegend =
  | { kind: "scalar"; min: number; max: number }
  | { kind: "classes"; classes: { label: string; color: string }[] };

function classCount(field: LayerField): number {
  const match = /^u8x(\d+)$/.exec(field.type);
  return match && field.labels?.length === Number(match[1]) ? Number(match[1]) : 0;
}

// Fields the viewer can color by: f16 scalars, and u8xN class probabilities that carry labels.
export function isColorable(field: LayerField): boolean {
  return field.type === "f16" || classCount(field) > 0;
}

// Paints the Gaussians whose u16 `field` (visual_cluster) is one of `ids`; the rest keep their own
// color. Same 4-byte layout as colorizeField. `matched` is how many Gaussians were painted.
export function highlightClusters(
  bin: ArrayBuffer,
  schema: LayerSchema,
  field: LayerField,
  ids: number[],
): { colors: Uint8Array; matched: number } {
  const view = new DataView(bin);
  const wanted = new Set(ids);
  const rgb = hexToRgb(HIGHLIGHT_HEX);
  const colors = new Uint8Array(schema.count * 4);
  let matched = 0;
  for (let i = 0; i < schema.count; i++) {
    if (!wanted.has(view.getUint16(i * schema.record_bytes + field.offset, true))) continue;
    colors.set(rgb, i * 4);
    colors[i * 4 + 3] = 1;
    matched++;
  }
  return { colors, matched };
}

// Colors every Gaussian by one field of layers.bin (contracts.md section 3). Returns 4 bytes per
// Gaussian: r, g, b in sRGB and a flag, where 0 means "no value here, keep the splat's own color".
export function colorizeField(
  bin: ArrayBuffer,
  schema: LayerSchema,
  field: LayerField,
): { colors: Uint8Array; legend: SplatLayerLegend } {
  const view = new DataView(bin);
  const colors = new Uint8Array(schema.count * 4);
  const classes = classCount(field);

  if (classes > 0) {
    const palette = field.labels!.map((_, i) => hexToRgb(classColorHex(i)));
    for (let i = 0; i < schema.count; i++) {
      const base = i * schema.record_bytes + field.offset;
      let best = 0;
      for (let c = 1; c < classes; c++) if (view.getUint8(base + c) > view.getUint8(base + best)) best = c;
      if (view.getUint8(base + best) === 0) continue; // all zero: unknown
      colors.set(palette[best], i * 4);
      colors[i * 4 + 3] = 1;
    }
    return { colors, legend: { kind: "classes", classes: field.labels!.map((label, i) => ({ label, color: classColorHex(i) })) } };
  }

  const values = new Float32Array(schema.count);
  for (let i = 0; i < schema.count; i++) {
    values[i] = THREE.DataUtils.fromHalfFloat(view.getUint16(i * schema.record_bytes + field.offset, true));
  }
  // Ramp over the 2nd to 98th percentile, so a few floaters do not flatten the colors.
  const sorted = values.filter(Number.isFinite).sort();
  const min = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const max = sorted[Math.floor(sorted.length * 0.98)] ?? 0;
  for (let i = 0; i < schema.count; i++) {
    if (!Number.isFinite(values[i])) continue;
    writeRampRgb(max > min ? (values[i] - min) / (max - min) : 0.5, colors, i * 4);
    colors[i * 4 + 3] = 1;
  }
  return { colors, legend: { kind: "scalar", min, max } };
}
