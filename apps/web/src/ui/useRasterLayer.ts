import { useEffect, useState } from "react";
import type { LoadedBundle } from "../scene/loadBundle";
import { loadRasterTexture } from "../scene/rasterOverlay";
import type { SceneRoot } from "../scene/SceneRoot";

// Which terrain raster (rasters/index.json) is draped on the terrain, if any.
// `bundle` must be the one SceneRoot is currently showing.
export function useRasterLayer(sceneRoot: SceneRoot | null, bundle: LoadedBundle | null) {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rasters = bundle?.rasters ?? [];
  const selected = rasters.find((raster) => raster.name === name) ?? null;

  useEffect(() => setName(null), [bundle]);

  useEffect(() => {
    setError(null);
    if (!sceneRoot || !selected) return;
    let cancelled = false;
    loadRasterTexture(selected)
      .then((texture) => (cancelled ? texture.dispose() : sceneRoot.setRasterOverlay(texture)))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      sceneRoot.setRasterOverlay(null);
    };
  }, [sceneRoot, selected]);

  return { rasters, selected, select: setName, error, shielding: bundle?.shielding ?? null };
}

export type RasterLayerState = ReturnType<typeof useRasterLayer>;
