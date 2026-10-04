import * as THREE from "three";
import { decode } from "fast-png";
import type { RasterLayer } from "../contracts";
import { writeRampRgb } from "./colorRamp";

// Fetches a terrain raster (contracts.md section 5) and colors it with the ramp, as a texture for
// createOverlayMesh. The PNG's row 0 is the north edge; the texture's row 0 is the south edge.
// A PNG with an alpha channel marks no-data cells with alpha 0: those stay fully transparent, so the
// terrain shows through instead of the ramp's lowest color.
export async function loadRasterTexture(raster: RasterLayer & { url: string }): Promise<THREE.DataTexture> {
  const response = await fetch(raster.url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} loading ${raster.url}`);
  const image = decode(await response.arrayBuffer());
  const maxPixel = image.depth === 16 ? 65535 : 255;
  const hasAlpha = image.channels === 2 || image.channels === 4;
  const data = new Uint8Array(image.width * image.height * 4);

  for (let row = 0; row < image.height; row++) {
    const sourceRow = image.height - 1 - row;
    for (let col = 0; col < image.width; col++) {
      const source = (sourceRow * image.width + col) * image.channels;
      if (hasAlpha && image.data[source + image.channels - 1] === 0) continue; // no data here
      const out = (row * image.width + col) * 4;
      writeRampRgb(image.data[source] / maxPixel, data, out);
      data[out + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, image.width, image.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Smoothing would blend data into the empty cells next to it, so rasters with gaps keep hard cell edges.
  texture.magFilter = hasAlpha ? THREE.NearestFilter : THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
