import type { LayerSchema, RasterLayer, SceneManifest, SciencePin, Shielding } from "../contracts";
import { decodeHeightfield, type Heightfield } from "./heightfield";
import { decodeSplatSurface, type SplatSurface } from "./splatSurface";

export type LoadedBundle = {
  manifest: SceneManifest;
  heightfield: Heightfield;
  splatSurface: SplatSurface | null;
  textureUrl: string | null;
  pins: SciencePin[];
  rasters: (RasterLayer & { url: string })[];
  shielding: Shielding | null;
  // Per-Gaussian layers; layers.bin is large, so it is only fetched when a layer is picked.
  splatLayers: { schema: LayerSchema; binUrl: string } | null;
};

export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

export function bundleFileUrl(sceneId: string, file: string): string {
  return `${BACKEND_URL}/scenes/${encodeURIComponent(sceneId)}/${file}`;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} loading ${url}`);
  return response;
}

export async function loadBundle(sceneId: string): Promise<LoadedBundle> {
  const manifest: SceneManifest = await (await fetchOk(bundleFileUrl(sceneId, "scene.json"))).json();

  const [terrainPng, pins, rasters, layerSchema, shielding, surfacePng] = await Promise.all([
    fetchOk(bundleFileUrl(sceneId, manifest.terrain.file)).then((r) => r.arrayBuffer()),
    manifest.pins
      ? fetchOk(bundleFileUrl(sceneId, manifest.pins)).then((r) => r.json() as Promise<SciencePin[]>)
      : Promise.resolve([]),
    manifest.rasters
      ? fetchOk(bundleFileUrl(sceneId, manifest.rasters)).then((r) => r.json() as Promise<RasterLayer[]>)
      : Promise.resolve([]),
    manifest.layers
      ? fetchOk(bundleFileUrl(sceneId, manifest.layers)).then((r) => r.json() as Promise<LayerSchema>)
      : Promise.resolve(null),
    manifest.shielding
      ? fetchOk(bundleFileUrl(sceneId, manifest.shielding)).then((r) => r.json() as Promise<Shielding>)
      : Promise.resolve(null),
    manifest.splat_surface
      ? fetchOk(bundleFileUrl(sceneId, manifest.splat_surface.file)).then((r) => r.arrayBuffer())
      : Promise.resolve(null),
  ]);
  // Raster files sit next to their index (rasters/index.json lists rasters/<file>).
  const rasterDir = manifest.rasters?.replace(/[^/]*$/, "") ?? "";

  return {
    manifest,
    heightfield: decodeHeightfield(terrainPng, manifest.terrain),
    splatSurface: surfacePng && manifest.splat_surface ? decodeSplatSurface(surfacePng, manifest.splat_surface) : null,
    textureUrl: manifest.terrain.texture ? bundleFileUrl(sceneId, manifest.terrain.texture) : null,
    pins,
    rasters: rasters.map((raster) => ({ ...raster, url: bundleFileUrl(sceneId, rasterDir + raster.file) })),
    shielding,
    // layers.bin sits next to layers.json (section 2).
    splatLayers: layerSchema && {
      schema: layerSchema,
      binUrl: bundleFileUrl(sceneId, manifest.layers!.replace(/[^/]*$/, "") + "layers.bin"),
    },
  };
}
