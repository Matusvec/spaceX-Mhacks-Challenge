import { useEffect, useState } from "react";
import type { LoadedBundle } from "../scene/loadBundle";
import { loadSiteValues, type SiteValues } from "../modules/siteValues";

/** The bundle's Moon rasters and shielding factors, decoded for the score. Null for a scene without them (Mars). */
export function useSiteValues(bundle: LoadedBundle | null): { values: SiteValues | null; error: string | null } {
  const [state, setState] = useState<{ values: SiteValues | null; error: string | null }>({ values: null, error: null });
  useEffect(() => {
    setState({ values: null, error: null });
    const wanted = bundle?.rasters.some((r) => ["illumination_pct", "earth_visible_pct", "dose_estimate"].includes(r.name));
    if (!bundle || !wanted) return;
    let cancelled = false;
    const load = async () => {
      try {
        const values = await loadSiteValues(bundle.rasters, bundle.manifest.terrain.size_m, bundle.shielding);
        if (!cancelled) setState({ values, error: null });
      } catch (err) {
        if (!cancelled) setState({ values: null, error: `Could not load the site rasters for the score: ${err instanceof Error ? err.message : String(err)}` });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [bundle]);
  return state;
}
