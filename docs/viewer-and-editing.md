# Viewer and editing: the web app

Owner: Claire. Location: `apps/web/`. React + Vite + TypeScript, plain three.js, Spark for splats.

Build everything against a placeholder bundle first (any public sample splat plus a synthetic heightmap), so the real Mars and Moon bundles drop in without code changes.

## Layout (match the Figma file from Humyra)

- **Center:** the 3D canvas.
- **Left panel:** scene switcher (Mars / Moon), layer toggles with legend, resolution, and source for each.
- **Right panel:** selected pin or module details, the scorecard, the concept render.
- **Bottom bar:** voice button, text query box, mode buttons (navigate, pin, place module, measure).
- **Top:** collaborators' avatars and colors.

## Module structure

```
apps/web/src/
  main.tsx
  App.tsx
  config/scoring.ts        thresholds and weights (single source of truth)
  scene/
    loadBundle.ts          fetch scene.json, layers, rasters, pins
    SceneRoot.ts           three.js scene, camera, renderer, site-frame root rotation
    splat.ts               Spark loading, progress, layer recoloring
    terrain.ts             heightfield mesh, texture, raster overlays
    sky.ts                 Moon: Sun disk and Earth sphere from az/el
    picking.ts             raycasts to terrain and splat
  layers/
    layerSchema.ts         parse layers.json, decode layers.bin into typed arrays
    colorize.ts            map a field to colors (legends, thresholds)
  modules/
    library.ts             procedural geometry per ModuleType
    placement.ts           snap to terrain, drag, rotate
    scoring.ts             compute Score (contracts.md section 8)
  paths/
    astar.ts               rover path over the terrain grid
  multiplayer/             Spacetime client glue (Humyra provides bindings)
  voice/                   mic capture, calls backend, executes intents
  ui/                      React panels
```

## Loading large splats

- Load `.spz` (compressed), never raw `.ply`, in production.
- Show a progress bar while fetching; render the terrain first so the screen is never empty.
- Spark 2.0 adds streaming for large splat worlds; use it if bundles stay large.
- Keep the splat cropped (the pipeline does this) so Gaussian counts stay in the low millions.

## Coordinate frame

The scene root is rotated by -90 degrees about X once, so `site` (+Z up) displays correctly in three.js (+Y up). Everything else (terrain, splat, modules, pins, cursors) lives in `site` coordinates under that root. Never convert elsewhere.

## Terrain

- `PlaneGeometry` sized to `terrain.size_m`, vertices displaced from `terrain.png` (decode per `contracts.md`). Subsample to about 512 by 512 vertices for performance; keep the full-resolution heights in a typed array for scoring and picking.
- Texture: `terrain_texture.jpg`.
- Raster overlays (`rasters/`): a second texture blended in the fragment shader with a colormap and opacity slider.
- Slope overlay: from the `slope_deg` raster or computed from the heights; show hazard thresholds (for example green under 5 degrees, yellow 5 to 15, red over 15; rover limit at 30).

## Layer display on the splat

1. Decode `layers.bin` into typed arrays using `layers.json` (no hardcoded offsets).
2. Recolor Gaussians by the active layer. Spark supports editing splat properties programmatically; check its docs for per-splat color or opacity edits.
3. **Fallback if per-splat recoloring is hard:** draw a three.js `Points` overlay at Gaussian centers (subsampled), colored by the layer. Less pretty, completely reliable.
4. Query results (cluster ids from the backend) highlight matching Gaussians and dim the rest.
5. Always show the active layer's source and resolution next to its legend.

## Base and terrarium design

Module library (procedural, simple materials, real dimensions):

| Type | Shape | Footprint |
|---|---|---|
| habitat | horizontal cylinder with end caps | about 8 m by 4 m |
| greenhouse_dome | hemisphere, translucent | about 10 m diameter |
| tunnel | thin cylinder between two modules | about 2 m diameter |
| landing_pad | flat disk with markings | about 30 m diameter (Mars) / 50 m (Moon) |
| solar_field | grid of tilted panels | about 20 m by 20 m |

Placement:
- Click or intent places a module; it raycasts to the terrain and sits at the median terrain height under its footprint.
- Drag in the horizontal plane; rotate with a handle or the R key.
- Every change writes to Spacetime (`multiplayer.md`), so all clients see it, and recomputes the score locally.

## Scoring (`modules/scoring.ts`)

Inputs: footprint polygon, full-resolution terrain heights, pins, the path planner, and Moon rasters if present.

1. Sample terrain heights on a grid inside the footprint (terrain resolution: 1 m on Mars, 5 m on the Moon).
2. `slopeMeanDeg`, `slopeMaxDeg` from the slope raster or height gradients.
3. `flatnessM` = standard deviation of heights.
4. `cutFillM3` = sum of |h_i - h_pad| times cell area, with h_pad = median height.
5. `distToScienceM` = distance to the nearest pin.
6. `roverReachable` = A* path exists from the rover start (or landing pad) with no step over the rover slope limit.
7. Moon: `illuminationPct`, `earthVisiblePct`, `doseEstimate_mSvPerYear` sampled from rasters at the module center (dose adjusted by the shielding slider).
8. `grade` (0 to 100): start at 100, subtract weighted penalties; defaults in `config/scoring.ts`:

```ts
export const SCORING = {
  slopeLimitDeg: { habitat: 5, greenhouse_dome: 5, landing_pad: 3, solar_field: 10, tunnel: 15 },
  weights: { slope: 30, flatness: 15, cutFill: 15, science: 15, access: 15, moonSun: 5, moonEarth: 5 },
  scienceIdealM: 50, scienceMaxM: 500,
  roverSlopeLimitDeg: 30,
};
```

9. `notes`: short reasons for every penalty ("max slope 9.1 deg exceeds 5 deg limit for habitat").

Scores must update in under about 50 ms while dragging; precompute slope once per scene.

## Rover path planning (`paths/astar.ts`)

- Grid = terrain cells (downsample to 2 to 5 m for speed on Mars, use 5 to 20 m on the Moon).
- Cost per step = distance times (1 + k * slope); blocked above the rover slope limit.
- Draw the path as a line draped slightly above the terrain; show length and maximum slope.

## Concept render (Grok Imagine)

1. Create the renderer with `preserveDrawingBuffer: true`, so the canvas can be captured.
2. Capture `canvas.toDataURL("image/jpeg", 0.85)` with the current view.
3. POST to the backend `/render` with a prompt built from the scene ("photoreal concept of a lunar habitat and greenhouse dome on this terrain, keep the terrain and lighting, Earth low on the horizon") plus the placed module types.
4. Show the returned image in the right panel, with "Concept render by Grok Imagine" as the label.

Never call xAI from the browser; the key lives on the backend.

## Voice and text

- Text box and voice button both go through the backend `/intent` (`backend.md`), which returns one intent (`contracts.md` section 9).
- `voice/executeIntent.ts` maps each intent to the same functions the UI buttons call.
- Show the recognized intent briefly on screen ("Finding flat bedrock within 50 m of Cheyava Falls"), so judges can see what happened.

## Moon specifics

- `sky.ts`: Sun disk and Earth sphere placed at az/el from `sky/*.json`; a time slider animates them and shadows (a directional light from the Sun's direction).
- Raster layers: illumination, Earth visibility, dose estimate (labeled estimate), slope.
- The radiation shielding slider lives in the module panel.

## Performance budget

- 60 fps target on a laptop GPU with the cropped splat plus terrain.
- Layer recoloring and query highlights apply in under 200 ms.
- First pixels on screen in under 3 seconds (terrain first, splat streams in).
