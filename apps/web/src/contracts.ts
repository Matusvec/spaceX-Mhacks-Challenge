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
