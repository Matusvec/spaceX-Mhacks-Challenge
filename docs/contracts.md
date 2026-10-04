# Contracts

Every component meets at the formats in this file. If you need to change one, tell the team first.

## 1. Coordinate frames

| Name | Definition | Used by |
|---|---|---|
| `site` | Local Cartesian frame per scene. Origin at the scene center on the terrain surface. +X east, +Y north, +Z up. Meters. | Everything in the app: viewer, scoring, Spacetime, Relay |
| `map` | The terrain model's projected coordinates (Mars: equirectangular meters from the USGS DTM; Moon: south polar stereographic meters from LOLA) | Pipelines only |
| `camera` | COLMAP / OpenCV convention: +Z forward, +X right, +Y down | Splat pipeline only |

Each scene bundle's `scene.json` stores the transform from `map` to `site`. Pipelines convert to `site` before writing a bundle. The web app never sees `map` or `camera` coordinates.

Note: three.js is +Y up by default. The viewer rotates the whole scene root by -90 degrees about X so `site` (+Z up) displays correctly. Do this once, at the scene root.

## 2. Scene bundle

A scene is a folder. The viewer loads only bundles, so a placeholder bundle and a real one are interchangeable.

```
scenes/<scene_id>/
  scene.json           manifest (below)
  splat.spz            compressed Gaussian splat in site frame (optional for Moon)
  terrain.png          16-bit grayscale heightmap
  terrain_texture.jpg  orthophoto / NAC image draped on the terrain (optional)
  layers.bin           per-Gaussian layer data (section 3), optional
  layers.json          layer schema and metadata (section 3), required if layers.bin exists
  clusters.json        visual-semantic cluster centroids (section 4), optional
  rasters/             per-terrain-cell layers for the Moon or wide area (section 5), optional
  pins.json            science pins (section 6)
```

### scene.json

```json
{
  "scene_id": "mars-hero-01",
  "body": "mars",
  "title": "Cheyava Falls, Jezero Crater",
  "site_origin_map": { "x": 0.0, "y": 0.0, "z": 0.0 },
  "map_crs": "describe the projection, e.g. Mars equirectangular, USGS TRN DTM",
  "splat": { "file": "splat.spz", "count": 1200000, "sh_degree": 1, "order_preserved": true },
  "terrain": {
    "file": "terrain.png",
    "texture": "terrain_texture.jpg",
    "size_m": [2000.0, 2000.0],
    "resolution_m": 1.0,
    "z_min_m": -40.0,
    "z_max_m": 60.0
  },
  "layers": "layers.json",
  "clusters": "clusters.json",
  "pins": "pins.json",
  "sources": [ { "name": "USGS Mars 2020 TRN HiRISE DTM", "url": "https://astrogeology.usgs.gov/..." } ]
}
```

Optional `"splat_surface": { "file": "splat_surface.png", "cell_m": 0.1, "west_m": -11.5, "north_m": 8.4, "z_min_m": -1.9, "z_max_m": 2.2, "estimate": true, "source": "...", "resolution": "10 cm cells" }`: the height of the splat's own surface (`pipelines/data/splat_surface.py`), because the 1 m terrain does not contain the rocks the splat shows. 16-bit grey PNG, row 0 is the north edge, column 0 starts at `west_m`. Pixel 0 means no data; otherwise `z_site = z_min_m + ((pixel - 1) / 65534) * (z_max_m - z_min_m)`. The viewer stands the rover on it where it has data and on the terrain elsewhere.

Terrain heightmap decoding: `z_site = z_min_m + (pixel / 65535) * (z_max_m - z_min_m)`. Pixel (0,0) is the north-west corner. The heightmap covers `size_m`, centered on the site origin.

## 3. Per-Gaussian layers (`layers.bin` + `layers.json`)

Layers are stored **by Gaussian index**, in the same order as the splat file. This only works if the compressor preserves order. Check `splat.order_preserved`; if a tool reorders, write layers after compression by matching positions, or compress with our own script.

`layers.bin` is a flat little-endian array of fixed-size records, one per Gaussian. `layers.json` describes each field so new layers can be added without code changes in the viewer.

```json
{
  "count": 1200000,
  "record_bytes": 24,
  "fields": [
    { "name": "elevation_m",  "type": "f16", "offset": 0,  "unit": "m",   "source": "HiRISE DTM", "resolution": "1 m/px" },
    { "name": "slope_deg",    "type": "f16", "offset": 2,  "unit": "deg", "source": "HiRISE DTM", "resolution": "1 m/px" },
    { "name": "roughness_m",  "type": "f16", "offset": 4,  "unit": "m",   "source": "splat geometry", "resolution": "~0.5 m neighborhood" },
    { "name": "height_above_ground_m", "type": "f16", "offset": 6, "unit": "m", "source": "splat vs DTM", "resolution": "per Gaussian" },
    { "name": "terrain_class", "type": "u8x4", "offset": 8, "labels": ["soil", "bedrock", "sand", "big_rock"], "scale": 255, "source": "our AI4Mars-trained model", "resolution": "per pixel in rover images" },
    { "name": "mineral", "type": "u8x2", "offset": 12, "labels": ["olivine", "carbonate"], "scale": 255, "source": "CRISM-derived maps", "resolution": "orbital, ~18 m/px" },
    { "name": "target_id", "type": "u16", "offset": 14, "none": 65535, "source": "pins.json", "resolution": "named rover targets" },
    { "name": "dist_to_target_m", "type": "f16", "offset": 16, "unit": "m" },
    { "name": "visual_cluster", "type": "u16", "offset": 18, "none": 65535, "source": "SAM + CLIP lifted, autoencoder, k-means" },
    { "name": "reserved", "type": "u8x4", "offset": 20 }
  ]
}
```

Rules:
- New layers append fields and bump `record_bytes`; never reorder existing fields.
- Every field carries `source` and `resolution`; the viewer shows them.
- `u8xN` probability-like values are stored as `value * scale`.

## 4. Visual-semantic clusters (`clusters.json`)

```json
{
  "encoder": "open_clip ViT-B-16 (laion2b)",
  "embed_dim": 512,
  "latent_dim": 16,
  "k": 256,
  "centroids_latent": [[0.1, -0.3, "... 16 floats"], "... 256 rows"],
  "decoder": "autoencoder decoder weights live in apps/backend/models/ae_decoder.pt"
}
```

The backend decodes the 256 centroids to 512 dims once at startup, so a query only compares the text embedding against 256 vectors.

## 5. Terrain rasters (`rasters/`)

For data that lives on the terrain grid rather than on Gaussians (all Moon analysis, wide-area Mars context):

```
rasters/<name>.png   8- or 16-bit grayscale, same extent and orientation as terrain.png
rasters/index.json   [{ "name": "illumination_pct", "file": "illumination_pct.png", "bits": 8, "min": 0, "max": 100, "unit": "%", "source": "computed from LOLA DEM + DE421 ephemeris", "resolution": "20 m/px", "estimate": false }]
```

Rasters may be coarser than `terrain.png`; the viewer resamples. Fields with `"estimate": true` must be labeled "estimate" in the UI (the radiation layer is always an estimate).

## 6. Science pins (`pins.json`)

```json
[
  {
    "id": 1,
    "name": "Cheyava Falls",
    "position_site": [3.2, -1.5, 0.4],
    "kind": "rover_target",
    "summary": "One or two sentences of what was found, from the cited source.",
    "measurements": [ { "label": "Organic carbon detected", "value": "yes", "source_url": "https://..." } ],
    "sample": { "name": "Sapphire Canyon", "number": 25 },
    "source_urls": ["https://..."]
  }
]
```

Only values copied from a cited source go in `measurements`. No invented numbers.

## 7. Shared state objects (Spacetime)

Full schema in `docs/multiplayer.md`. The shapes every client relies on:

```ts
type Vec3 = { x: number; y: number; z: number };          // site frame, meters

type Pin = { id: bigint; sceneId: string; author: string; position: Vec3; note: string; createdAt: bigint };

type ModuleType = "habitat" | "greenhouse_dome" | "tunnel" | "landing_pad" | "solar_field";
type PlacedModule = {
  id: bigint; sceneId: string; author: string; type: ModuleType;
  position: Vec3; rotationZDeg: number; scale: number;
  scoreJson: string;                                        // last computed Score, JSON
};

type Highlight = { id: bigint; sceneId: string; author: string; queryText: string; gaussianClusterIds: number[]; color: string };
```

## 8. Score object

Computed client-side in the viewer (instant while dragging), stored in `PlacedModule.scoreJson` so Relay can read it.

```ts
type Score = {
  grade: number;                // 0 to 100
  slopeMeanDeg: number;
  slopeMaxDeg: number;
  flatnessM: number;            // std dev of terrain heights under the footprint
  cutFillM3: number;            // ground to move to level the pad at the median height
  distToScienceM: number | null;
  roverReachable: boolean | null;
  illuminationPct?: number;     // Moon
  earthVisiblePct?: number;     // Moon
  doseEstimate_mSvPerYear?: number; // Moon, always labeled estimate
  notes: string[];              // short human-readable reasons, e.g. "max slope 9.1 deg exceeds 5 deg limit"
};
```

Default thresholds and weights are in `docs/viewer-and-editing.md` and live in one config file so they can be tuned.

## 9. Voice and text intents

Grok (voice or text) maps a request to exactly one of these. The web app and the Relay agent both execute intents through the same functions.

```json
{ "intent": "find_sites",   "args": { "max_slope_deg": 5, "near_pin": "Cheyava Falls", "within_m": 50, "terrain_class": "bedrock", "min_carbonate": 0.5 } }
{ "intent": "place_module", "args": { "type": "habitat", "at": "selected_site" } }
{ "intent": "show_path",    "args": { "from": "rover", "to": "selected_site" } }
{ "intent": "query_scene",  "args": { "text": "veined light-toned rock" } }
{ "intent": "render_concept", "args": { "idea": "three domes linked by tunnels" } }
{ "intent": "toggle_layer", "args": { "layer": "slope_deg", "on": true } }
{ "intent": "compare_sites", "args": { "a": 12, "b": 15 } }
```

## 10. Backend API (summary)

Full detail in `docs/backend.md`. Base URL from `VITE_BACKEND_URL`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/intent` | `{ text, scene_id, context }` | one intent object (section 9) |
| POST | `/query` | `{ scene_id, text?, filters? }` | `{ cluster_ids, gaussian_mask_rle?, explanation }` |
| POST | `/concept` | `{ scene_id, prompt?, image?, modules? }` | `{ id, image_url, view_url, prompt, mode, model, note }` (Grok Imagine) |
| GET | `/concepts?scene_id=` | | the last eight concept renders, newest first |
| POST | `/voice/transcribe` | recorded audio (raw body) | `{ text }` (Grok Voice) |
| POST | `/voice/speak` | `{ text }` | MP3 audio (Grok Voice) |
| GET | `/scenes/{scene_id}/{file}` | | static bundle files |
