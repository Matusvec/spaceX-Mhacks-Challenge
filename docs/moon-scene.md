# Moon scene: Malapert Massif

Owner: Matus (physics scripts, done in training gaps). Runs on the laptop CPU or Colab CPU. Output: a scene bundle with terrain, texture, and rasters (`contracts.md`); no splat required.

## Why this site

Malapert Massif is a mountain about 5 km tall near the lunar south pole and one of NASA's nine Artemis III candidate regions. Parts of it see near-continuous sunlight. NASA's LOLA team publishes a 5 m/px elevation model, slope map, and laser point cloud for it, and LROC has a low-Sun high-resolution image mosaic. Everyone is actively planning south pole bases, so this is the moonbase story.

## Data (links in `data-sources.md`)

- LOLA 5 m/px DEM + slope for Site 23 (Malapert massif), polar stereographic GeoTIFF.
- A larger, coarser south pole DEM for the far-field horizon.
- LROC NAC low-Sun mosaic of Malapert, for the texture.
- DE421 ephemeris + Moon frame kernels for `skyfield`.

## Step 1: build the terrain bundle

1. Crop the 5 m DEM to about 4 km by 4 km around the candidate landing area. Choose the center by eye from the slope map: a broad low-slope area near the summit ridge.
2. Write `terrain.png` (16-bit) and `scene.json` (`body: "moon"`, `resolution_m: 5`), converting to the `site` frame (`contracts.md`).
3. Reproject and crop the NAC mosaic to the same extent; write `terrain_texture.jpg`.
4. Copy the LOLA slope map into `rasters/slope_deg.png` (do not recompute what NASA already provides).

## Step 2: horizon profiles (shared by sunlight, Earth, radiation)

For each analysis cell (resample to 20 m for speed, about 200 by 200 cells):
1. For 360 azimuth bins (1 degree each), march outward along the ray over the local 5 m DEM, then the far-field DEM out to about 100 km, and record the maximum elevation angle of terrain: `h(az)`.
2. Account for lunar curvature on long rays: subtract `d^2 / (2 R_moon)` from terrain height at distance `d` (R_moon = 1,737.4 km).
3. Save `horizon.npy` with shape `[cells_y, cells_x, 360]`.

Vectorize with numpy; it runs in minutes on a laptop.

## Step 3: Sun and Earth positions

Use `skyfield` with the Moon's principal-axes frame to get the azimuth and elevation of the Sun and Earth from a point on the lunar surface (the skyfield documentation's "coordinates on the Moon" example shows the setup with `moon_080317.tf`, `pck00008.tca`, `moon_pa_de421_1900-2050.bpc`).

- Sample one lunar year at 6-hour steps (about 1,460 times), starting from a chosen date.
- Compute positions from the scene center; the change across a 4 km scene is negligible for this purpose.
- Save `sun_azel.npy` and `earth_azel.npy`.

## Step 4: illumination map

A cell is lit at time t if the Sun's elevation exceeds the horizon at the Sun's azimuth. Use the solar disk (about 0.27 degree radius) to compute partial illumination as the fraction of the disk above the horizon.

`illumination_pct = mean over t of fraction_lit(t)`, written to `rasters/illumination_pct.png` (`estimate: false`, `resolution: "20 m/px"`).

Also keep the time series for the scene center: the viewer can animate the Sun moving across the sky and shadows sweeping the terrain.

## Step 5: Earth visibility map

Same as sunlight, with Earth's position (Earth's apparent diameter from the Moon is about 2 degrees). `earth_visible_pct` goes to `rasters/earth_visible_pct.png`. This is the direct-to-Earth communications metric.

### The Earth in the sky

The viewer draws Earth as a textured sphere at the computed azimuth and elevation, with apparent size about 2 degrees, plus the Sun as a bright disk. From the south pole, Earth sits near the horizon and can dip behind terrain. That's both the hero shot and the comms story.

## Step 6: radiation simulator (always labeled "estimate")

**Model:**
- **Baseline:** the Chang'e 4 measurement at the lunar surface, about 1,369 microsieverts per day (dose equivalent). That measurement already includes flat open ground, where the Moon blocks half the sky.
- **Terrain shielding:** galactic cosmic rays arrive roughly isotropically, so dose scales with the open solid angle above the local horizon. Open-sky fraction relative to flat ground:

```
f = (1 / 2pi) * integral over azimuth of (1 - sin(h(az))) d az
dose_site = baseline * f
```

  With flat ground (h = 0 everywhere) f = 1. A site against a ridge has f < 1.
- **Habitat shielding:** a slider for meters of regolith over the habitat. Reduction factors come from published shielding curves (digitize a few points from the 2024 Space Weather paper or the regolith shielding review in `data-sources.md`, cite them in the UI). Do not invent the curve.
- **Output:** `rasters/dose_estimate.png` (mSv per year at the surface, `estimate: true`), and per module, `doseEstimate_mSvPerYear` using the module's location and shielding setting.

**Limits to state in the UI:** first-order model; ignores secondary neutrons from the surface, solar particle events (which are directional and episodic), and spectrum changes from shielding. Good for comparing sites, not for medical dose planning.

## Outputs checklist

```
scenes/moon-malapert/
  scene.json
  terrain.png
  terrain_texture.jpg
  rasters/
    index.json
    slope_deg.png
    illumination_pct.png
    earth_visible_pct.png
    dose_estimate.png
  sky/
    sun_azel.json      time series for animation (downsampled)
    earth_azel.json
  pins.json            notable features from the Malapert studies
```
