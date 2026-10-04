import type { SceneManifest, SciencePin } from "../contracts";
import { decodeHeightfield, type Heightfield } from "./heightfield";

export type LoadedBundle = {
  manifest: SceneManifest;
  heightfield: Heightfield;
  textureUrl: string | null;
  pins: SciencePin[];
};

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

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

  const [terrainPng, pins] = await Promise.all([
    fetchOk(bundleFileUrl(sceneId, manifest.terrain.file)).then((r) => r.arrayBuffer()),
    manifest.pins
      ? fetchOk(bundleFileUrl(sceneId, manifest.pins)).then((r) => r.json() as Promise<SciencePin[]>)
      : Promise.resolve([]),
  ]);

  return {
    manifest,
    heightfield: decodeHeightfield(terrainPng, manifest.terrain),
    textureUrl: manifest.terrain.texture ? bundleFileUrl(sceneId, manifest.terrain.texture) : null,
    pins,
  };
}
