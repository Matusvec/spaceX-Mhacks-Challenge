#!/usr/bin/env python3
"""Cut the terrain window around the Mars site straight out of the remote USGS files
(1.8 GB DTM, 7.4 GB orthophoto) with HTTP range reads, and write the terrain half of
a scene bundle (docs/contracts.md section 2).

  uv run --no-project --with rasterio --with pillow python pipelines/data/fetch_mars_terrain.py

Output: data/terrain/<scene>/{dtm.tif,ortho.tif} (georeferenced crops, map frame)
        scenes/<scene>/{terrain.png,terrain_texture.jpg,scene.json}
"""
import json
import math
import time
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import Window

SCENE_ID = "mars-hero-01"
TITLE = "Cheyava Falls, Neretva Vallis, Jezero Crater"
# Rover position at site 56 drive 0 (sols 1210-1219), from M20_waypoints.json
LON, LAT = 77.30519089, 18.49748444
SIZE_M = 2000          # square window, centred on the rover
TEXTURE_PX = 4000      # 0.5 m/px drape; the source is 0.25 m/px

BASE = "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/"
DTM = BASE + "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
ORTHO = BASE + "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif"
R_MARS = 3396190.0     # sphere used by both files' equirectangular projection (lat_ts=0, lon_0=0)
# Both files are uncompressed one-row strips: direct IO fetches only the bytes inside the window.
ENV = dict(GTIFF_DIRECT_IO="YES", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
           CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2")


def crop(url, x, y, size_m, out_px, dst):
    """Read a size_m square centred on map (x, y), resampled to out_px, and save it as a GeoTIFF."""
    with rasterio.open("/vsicurl/" + url) as ds:
        row, col = ds.index(x, y)
        n = round(size_m / ds.res[0])
        win = Window(col - n // 2, row - n // 2, n, n)
        assert 0 <= win.col_off and win.col_off + n <= ds.width and 0 <= win.row_off and win.row_off + n <= ds.height, \
            "window leaves the raster; use the wider Mars Sample Return mosaics (docs/data-sources.md)"
        # Read in bands of rows with retries: one long read dies on the first dropped connection.
        bands, rows, step = [], out_px // 20, n // 20
        for i in range(20):
            band = Window(win.col_off, win.row_off + i * step, n, step)
            for attempt in range(5):
                try:
                    bands.append(ds.read(1, window=band, out_shape=(rows, out_px)))
                    break
                except rasterio.errors.RasterioIOError as e:
                    print(f"  band {i} retry {attempt + 1}: {e}")
                    time.sleep(3)
            else:
                raise SystemExit(f"gave up on band {i}; re-run when the network is less busy")
            print(f"  {i + 1}/20", end="\r", flush=True)
        arr = np.concatenate(bands)
        profile = dict(driver="GTiff", width=out_px, height=out_px, count=1, dtype=arr.dtype, crs=ds.crs,
                       nodata=ds.nodata, compress="deflate",
                       transform=ds.window_transform(win) * ds.transform.scale(n / out_px))
        with rasterio.open(dst, "w", **profile) as out:
            out.write(arr, 1)
        return arr, ds.nodata


def main():
    x, y = R_MARS * math.radians(LON), R_MARS * math.radians(LAT)
    raw_dir, bundle = Path("data/terrain") / SCENE_ID, Path("scenes") / SCENE_ID
    raw_dir.mkdir(parents=True, exist_ok=True)
    bundle.mkdir(parents=True, exist_ok=True)

    with rasterio.Env(**ENV):
        print("reading DTM window ...")
        z, nodata = crop(DTM, x, y, SIZE_M, SIZE_M, raw_dir / "dtm.tif")
        print("reading orthophoto window ...")
        ortho, _ = crop(ORTHO, x, y, SIZE_M, TEXTURE_PX, raw_dir / "ortho.tif")

    hole = ~np.isfinite(z) | (z == nodata) | (z < -1e6)
    print(f"DTM {z.shape}, {hole.mean():.2%} nodata, ortho {ortho.shape}, {(ortho == 0).mean():.2%} empty")
    z0 = float(z[SIZE_M // 2, SIZE_M // 2])          # site origin sits on the terrain surface
    z = np.where(hole, z[~hole].min(), z) - z0        # site frame: +Z up, metres above the origin
    z_min, z_max = float(z.min()), float(z.max())
    png = np.round((z - z_min) / (z_max - z_min) * 65535).astype(np.uint16)
    Image.fromarray(png).save(bundle / "terrain.png")    # row 0 = north, so pixel (0,0) is the NW corner
    Image.fromarray(ortho).save(bundle / "terrain_texture.jpg", quality=88)

    scene = {
        "scene_id": SCENE_ID, "body": "mars", "title": TITLE,
        "site_origin_map": {"x": x, "y": y, "z": z0},
        "map_crs": "Mars equirectangular (lat_ts=0, lon_0=0, sphere R=3396190 m), USGS Mars 2020 TRN HiRISE DTM; "
                   "z is metres above the MOLA geoid",
        # The window is SIZE_M map units square, and the map is equirectangular with its standard
        # parallel at the equator: at this latitude one map unit east is only cos(lat) real metres.
        "terrain": {"file": "terrain.png", "texture": "terrain_texture.jpg",
                    "size_m": [round(SIZE_M * math.cos(math.radians(LAT)), 2), float(SIZE_M)],
                    "resolution_m": 1.0, "z_min_m": round(z_min, 3), "z_max_m": round(z_max, 3)},
        "pins": "pins.json",
        "sources": [
            {"name": "USGS Mars 2020 TRN HiRISE DTM mosaic, 1 m/px", "url": DTM},
            {"name": "USGS Mars 2020 TRN HiRISE orthomosaic, 25 cm/px (shown at 50 cm/px)", "url": ORTHO},
        ],
    }
    manifest = bundle / "scene.json"
    if manifest.exists():    # keep the splat/layers entries other pipeline steps add
        scene = {**json.loads(manifest.read_text()), **scene}
    manifest.write_text(json.dumps(scene, indent=2) + "\n")
    if not (bundle / "pins.json").exists():
        (bundle / "pins.json").write_text("[]\n")
    print(f"wrote {bundle}/  z range {z_min:.1f} .. {z_max:.1f} m around origin z={z0:.1f} m")


if __name__ == "__main__":
    main()
