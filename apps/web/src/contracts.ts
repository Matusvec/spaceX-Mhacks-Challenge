// Types mirroring docs/contracts.md. Change that doc first, then this file.

export type Body = "mars" | "moon";

export type Source = { name: string; url: string };

export type SceneManifest = {
  scene_id: string;
  body: Body;
  title: string;
  site_origin_map: { x: number; y: number; z: number };
  map_crs: string;
  splat?: { file: string; count: number; sh_degree: number; order_preserved: boolean; crop_radius_m?: number };
  // Fine height map of the splat's surface: 16-bit grey PNG, row 0 = north edge, pixel 0 = no data.
  splat_surface?: { file: string; cell_m: number; west_m: number; north_m: number; z_min_m: number; z_max_m: number };
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
  rasters?: string;
  shielding?: string;
  pins?: string;
  sources: Source[];
};

// One entry of rasters/index.json (section 5). value = min + pixel / (2^bits - 1) * (max - min).
export type RasterLayer = {
  name: string;
  file: string;
  bits: 8 | 16;
  min: number;
  max: number;
  unit: string;
  source: string;
  resolution: string;
  estimate: boolean;
  source_url?: string;
  description?: string;
  coverage_pct?: number; // share of the terrain window that has data; the PNG's alpha is 0 elsewhere
};

// shielding.json: sourced factors by which regolith cover changes the Moon's dose_estimate layer.
export type Shielding = {
  points: { depth_m: number; factor: number; quote: string; source_url: string }[];
  limits: string;
  unit_depth: string;
  source: { citation: string; url: string };
};

// layers.json (section 3): how to read one fixed-size record of layers.bin per Gaussian.
export type LayerField = {
  name: string;
  type: string; // "f16", "u16", "u8xN"
  offset: number;
  unit?: string;
  source?: string;
  resolution?: string;
  labels?: string[];
  scale?: number;
  none?: number;
  estimate?: boolean;
};

export type LayerSchema = { count: number; record_bytes: number; fields: LayerField[] };

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
  | { intent: "render_concept"; args: { idea?: string } }
  | { intent: "answer"; args: { text: string } } // Grok's own short reply, grounded in the scene facts sent with the request
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

// Section 7: shared state objects (Spacetime). Positions are site-frame metres.
export type Vec3 = { x: number; y: number; z: number };

// A user's note on the terrain. Never a science pin: no measurements, no citation.
export type Pin = { id: bigint; sceneId: string; author: string; position: Vec3; note: string; createdAt: bigint };

export type PlacedModule = {
  id: bigint;
  sceneId: string;
  author: string;
  type: ModuleType;
  position: Vec3;
  rotationZDeg: number;
  scale: number;
  scoreJson: string; // last computed Score, JSON
};
