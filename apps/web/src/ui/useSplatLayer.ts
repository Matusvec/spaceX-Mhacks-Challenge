import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_URL, type LoadedBundle } from "../scene/loadBundle";
import type { SceneRoot } from "../scene/SceneRoot";
import { colorizeField, highlightClusters, isColorable, type SplatLayerLegend } from "../scene/splatLayers";
import { loadPresets, PRESET_SEARCH, presetAnswer } from "./presetSearch";
import type { SplatState } from "./useSplatLoader";

// A text query answered by the backend's /query (contracts.md section 10).
export type SplatQuery = { text: string; clusterIds: number[]; explanation: string };

// What the splat is colored by: one per-Gaussian layer of layers.bin (contracts.md section 3), or the
// Gaussians matching a text query, or nothing. `bundle` must be the one SceneRoot is currently showing.
export function useSplatLayer(sceneRoot: SceneRoot | null, bundle: LoadedBundle | null, splatState: SplatState) {
  const [name, setName] = useState<string | null>(null);
  const [query, setQuery] = useState<SplatQuery | null>(null);
  const [searching, setSearching] = useState(false);
  const [matched, setMatched] = useState<number | null>(null);
  const [legend, setLegend] = useState<SplatLayerLegend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const binCache = useRef<{ url: string; bin: Promise<ArrayBuffer> } | null>(null);

  const layers = bundle?.splatLayers ?? null;
  const fields = layers?.schema.fields.filter(isColorable) ?? [];
  const clusterField = layers?.schema.fields.find((f) => f.name === "visual_cluster" && f.type === "u16") ?? null;
  const bundleSplat = splatState.status === "ready" && splatState.origin === "bundle" ? splatState.info : null;
  const sceneId = bundle?.manifest.scene_id;

  // Records match Gaussians by index, so the layers only fit the bundle's own splat, in file order.
  let unavailable: string | null = null;
  if (!layers) unavailable = "This scene has no splat layers.";
  else if (!bundleSplat) unavailable = "Needs the scene bundle's own splat.";
  else if (bundle?.manifest.splat?.order_preserved !== true) {
    unavailable = "Off: this splat was not exported in layer order (splat.order_preserved is not true).";
  } else if (layers.schema.count !== bundleSplat.count) {
    unavailable = `Off: layers.json has ${layers.schema.count.toLocaleString()} records but the splat has ${bundleSplat.count.toLocaleString()} Gaussians.`;
  }
  let queryUnavailable = unavailable;
  if (!queryUnavailable && (!clusterField || !bundle?.manifest.clusters)) queryUnavailable = "This scene has no visual clusters to search.";
  if (!queryUnavailable && !BACKEND_URL && !PRESET_SEARCH) queryUnavailable = "Search needs the backend: start the viewer with VITE_BACKEND_URL set.";

  const selected = unavailable ? null : (fields.find((field) => field.name === name) ?? null);
  const activeQuery = queryUnavailable ? null : query;

  useEffect(() => {
    setName(null);
    setQuery(null);
  }, [bundle]);

  useEffect(() => {
    setError(null);
    setLegend(null);
    setMatched(null);
    if (!sceneRoot || !layers || (!selected && !activeQuery)) return;
    let cancelled = false;
    if (binCache.current?.url !== layers.binUrl) {
      const bin = fetch(layers.binUrl).then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText} loading ${layers.binUrl}`);
        return response.arrayBuffer();
      });
      binCache.current = { url: layers.binUrl, bin };
    }
    binCache.current.bin
      .then((bin) => {
        if (cancelled) return;
        if (bin.byteLength < layers.schema.count * layers.schema.record_bytes) {
          throw new Error("layers.bin is shorter than layers.json says");
        }
        if (activeQuery && clusterField) {
          const result = highlightClusters(bin, layers.schema, clusterField, activeQuery.clusterIds);
          sceneRoot.setSplatColors(result.colors);
          setMatched(result.matched);
        } else if (selected) {
          const result = colorizeField(bin, layers.schema, selected);
          sceneRoot.setSplatColors(result.colors);
          setLegend(result.legend);
        }
      })
      .catch((err: unknown) => {
        binCache.current = null;
        if (!cancelled) setError(`Could not load layer: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      cancelled = true;
      sceneRoot.setSplatColors(null);
    };
  }, [sceneRoot, layers, selected, activeQuery, clusterField]);

  // Deployed build: the phrases whose answers were computed ahead (see presetSearch.ts).
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    setSuggestions([]);
    if (!PRESET_SEARCH || !sceneId) return;
    let cancelled = false;
    void loadPresets(sceneId).then((presets) => !cancelled && setSuggestions(presets.map((preset) => preset.text)));
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  // Asks the backend which visual clusters fit `text`, then highlights their Gaussians.
  const search = useCallback(
    async (text: string) => {
      if (!sceneId || !text.trim()) return;
      setSearching(true);
      setError(null);
      try {
        if (PRESET_SEARCH) {
          const preset = await presetAnswer(sceneId, text);
          if (!preset) throw new Error("this hosted copy only answers the suggested searches. Open search needs the team's own backend.");
          setName(null);
          setQuery({ text: preset.text, clusterIds: preset.cluster_ids, explanation: preset.explanation });
          return;
        }
        const response = await fetch(`${BACKEND_URL}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene_id: sceneId, text: text.trim() }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `${response.status} from /query`);
        setName(null);
        setQuery({ text: text.trim(), clusterIds: body.cluster_ids, explanation: body.explanation });
      } catch (err) {
        setQuery(null);
        setError(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSearching(false);
      }
    },
    [sceneId],
  );

  const select = (field: string | null) => {
    setQuery(null);
    setName(field);
  };

  return {
    hasLayers: layers !== null,
    fields,
    selected,
    legend,
    unavailable,
    error,
    select,
    clusterField,
    queryUnavailable,
    query: activeQuery,
    matched,
    total: layers?.schema.count ?? 0,
    searching,
    search,
    suggestions,
    clearQuery: () => setQuery(null),
  };
}

export type SplatLayerState = ReturnType<typeof useSplatLayer>;
