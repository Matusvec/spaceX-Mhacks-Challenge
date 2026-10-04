// Colors shared by terrain rasters and splat layers. Everything here is in sRGB bytes and blends
// in sRGB, the same way a CSS linear-gradient does, so a map matches its legend bar.
type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

// Sequential ramp, one hue: low values recede into the dark scene, high values are light.
const RAMP_HEX = ["#0d366b", "#3987e5", "#cde2fb"];
const RAMP = RAMP_HEX.map(hexToRgb);
export const RAMP_CSS = `linear-gradient(to right, ${RAMP_HEX.join(", ")})`;

// Writes the ramp color for t in 0..1 as three bytes at out[offset].
export function writeRampRgb(t: number, out: Uint8Array, offset: number): void {
  const scaled = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
  const lower = Math.min(Math.floor(scaled), RAMP.length - 2);
  const f = scaled - lower;
  for (let c = 0; c < 3; c++) out[offset + c] = Math.round(RAMP[lower][c] + (RAMP[lower + 1][c] - RAMP[lower][c]) * f);
}

// Gaussians that match a text query.
export const HIGHLIGHT_HEX = "#3987e5";

// Class colors in label order. These four stay distinguishable from one another, including for
// color-blind viewers; the legend always names them.
// ponytail: four colors; a fifth class and later share the gray. Split the classes if that matters.
const CLASS_HEX = ["#3987e5", "#c98500", "#d55181", "#008300"];
const OTHER_CLASS_HEX = "#8a909c";

export function classColorHex(index: number): string {
  return CLASS_HEX[index] ?? OTHER_CLASS_HEX;
}
