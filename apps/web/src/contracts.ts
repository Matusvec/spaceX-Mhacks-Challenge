// Types mirroring docs/contracts.md. Change that doc first, then this file.

export type Body = "mars" | "moon";

export type Source = { name: string; url: string };

export type SceneManifest = {
  scene_id: string;
  body: Body;
  title: string;
  site_origin_map: { x: number; y: number; z: number };
  map_crs: string;
  splat?: { file: string; count: number; sh_degree: number; order_preserved: boolean };
  terrain: {
    file: string;
    texture?: string;
    size_m: [number, number];
    resolution_m: number;
    z_min_m: number;
    z_max_m: number;
  };
  layers?: string;
  clusters?: string;
  pins?: string;
  sources: Source[];
};

export type ModuleType = "habitat" | "greenhouse_dome" | "tunnel" | "landing_pad" | "solar_field";

export type Score = {
  grade: number;
  slopeMeanDeg: number;
  slopeMaxDeg: number;
  flatnessM: number;
  cutFillM3: number;
  distToScienceM: number | null;
  roverReachable: boolean | null;
  illuminationPct?: number;
  earthVisiblePct?: number;
  doseEstimate_mSvPerYear?: number;
  notes: string[];
};

// Section 9. `drive` on show_path is a proposed addition: plan the route and also drive it.
export type Intent =
  | {
      intent: "find_sites";
      args: { max_slope_deg?: number; near_pin?: string; within_m?: number; terrain_class?: string; min_carbonate?: number };
    }
  | { intent: "place_module"; args: { type: ModuleType; at: string } }
  | { intent: "show_path"; args: { from: string; to: string; drive?: boolean } }
  | { intent: "query_scene"; args: { text: string } }
  | { intent: "render_concept"; args: Record<string, never> }
  | { intent: "toggle_layer"; args: { layer: string; on: boolean } }
  | { intent: "compare_sites"; args: { a: number; b: number } };

export type SciencePin = {
  id: number;
  name: string;
  position_site: [number, number, number];
  kind: string;
  summary: string;
  measurements: { label: string; value: string; source_url: string }[];
  sample?: { name: string; number: number };
  source_urls: string[];
};
