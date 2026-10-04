"""Step 1 of docs/moon-scene.md: cut the scene window out of the LOLA 5 m DEM and slope map and
write the terrain half of the bundle (docs/contracts.md sections 2 and 5).

  uv run --no-project --with rasterio --with skyfield --with pillow --with numpy python pipelines/moon/build_terrain.py

Output: scenes/moon-malapert-01/{scene.json, terrain.png, pins.json, rasters/slope_deg.png, rasters/index.json}
terrain_texture.jpg is written by texture.py (computed shaded relief; the LROC NAC mosaic is not downloaded).
"""
import json

import numpy as np
import rasterio
from PIL import Image
from rasterio.windows import Window

from common import (BUNDLE, CENTER_MAP, DEM_5M, OBSERVER_HEIGHT_M, R_MOON, RES_M, SCENE_ID, SIZE_M, SLOPE_5M,
                    URL_5M, URL_FAR, map_to_lonlat, write_raster)


def crop(path):
    """The SIZE_M square around CENTER_MAP at the file's own 5 m grid. No resampling: pixels are copied."""
    with rasterio.open(path) as ds:
        assert ds.res == (RES_M, RES_M), ds.res
        n = round(SIZE_M / RES_M)
        col, row = ~ds.transform * (CENTER_MAP[0] - SIZE_M / 2, CENTER_MAP[1] + SIZE_M / 2)   # NW corner
        assert col == round(col) and row == round(row), "scene window is not aligned to the DEM pixel grid"
        assert 0 <= col and col + n <= ds.width and 0 <= row and row + n <= ds.height, "window leaves the DEM"
        arr = ds.read(1, window=Window(round(col), round(row), n, n))
    assert np.isfinite(arr).all(), f"{path} has holes inside the scene window"
    return arr.astype(np.float64)


def main():
    BUNDLE.mkdir(parents=True, exist_ok=True)
    z_map = crop(DEM_5M)                       # metres above the 1,737.4 km sphere; row 0 = north
    mid = z_map.shape[0] // 2
    z0 = float(z_map[mid - 1:mid + 1, mid - 1:mid + 1].mean())   # the centre is a pixel corner: mean of the 4 around it
    z = z_map - z0                             # site frame: +Z up, metres above the origin
    z_min, z_max = float(z.min()), float(z.max())
    Image.fromarray(np.round((z - z_min) / (z_max - z_min) * 65535).astype(np.uint16)).save(BUNDLE / "terrain.png")

    slope = crop(SLOPE_5M)
    slope_max = float(np.ceil(slope.max() / 10) * 10)      # next multiple of 10 deg, so the colour ramp is used
    write_raster("slope_deg", slope, 0.0, slope_max, 16, unit="deg", quantisation_deg=round(slope_max / 65535, 6),
                 source="NASA PGDA LOLA 5 m/px slope map, Site 23 (Malapert massif); copied, not recomputed",
                 source_url=URL_5M, resolution="5 m/px", estimate=False)

    lon, lat = np.degrees(map_to_lonlat(*CENTER_MAP))
    scene = {
        "scene_id": SCENE_ID, "body": "moon", "title": "Malapert Massif summit plateau, lunar south pole",
        "site_origin_map": {"x": CENTER_MAP[0], "y": CENTER_MAP[1], "z": z0},
        "map_crs": f"Moon south polar stereographic (lat_0=-90, lon_0=0, true scale at the pole, sphere R={R_MOON:.0f} m), "
                   "MOON_ME frame (DE421), NASA PGDA LOLA DEM; z is metres above the sphere",
        "site_frame": {
            "center_lon_deg": round(float(lon), 5), "center_lat_deg": round(float(lat), 5),
            "y_axis_true_azimuth_deg": round(float(-lon), 4),
            "note": "site axes are the map grid axes (site = map - site_origin_map), not rotated to true north: "
                    "site +Y points y_axis_true_azimuth_deg from true north (negative = west of north). "
                    "Azimuths in sky/*.json are site azimuths: from site +Y, clockwise towards site +X.",
        },
        "terrain": {"file": "terrain.png", "size_m": [SIZE_M, SIZE_M], "resolution_m": RES_M,
                    "z_min_m": round(z_min, 3), "z_max_m": round(z_max, 3)},
        "rasters": "rasters/index.json",
        "analysis": {"cell_m": 20.0, "observer_height_m": OBSERVER_HEIGHT_M,
                     "note": "illumination, Earth visibility and dose are evaluated at observer_height_m above the surface"},
        "pins": "pins.json",
        "sources": [
            {"name": "NASA PGDA LOLA 5 m/px DEM and slope map, Site 23 (Malapert massif)", "url": URL_5M},
            {"name": "NASA PGDA LOLA south pole DEM to 80 S, 80 m/px (far-field horizon)", "url": URL_FAR},
            {"name": "JPL DE421 ephemeris (Sun and Earth positions)", "url": "https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de421.bsp"},
            {"name": "NAIF lunar frame kernels: moon_080317.tf, pck00008.tpc, moon_pa_de421_1900-2050.bpc",
             "url": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"},
            {"name": "Chang'e 4 lunar surface radiation measurement (baseline of the dose estimate)",
             "url": "https://www.science.org/doi/10.1126/sciadv.aaz1334"},
        ],
    }
    manifest = BUNDLE / "scene.json"
    if manifest.exists():    # keep what later steps add: sky (maps.py), terrain.texture and its source (texture.py)
        old = json.loads(manifest.read_text())
        names = {s["name"] for s in scene["sources"]}
        scene = {**old, **scene, "terrain": {**old.get("terrain", {}), **scene["terrain"]},
                 "sources": scene["sources"] + [s for s in old.get("sources", []) if s["name"] not in names]}
    manifest.write_text(json.dumps(scene, indent=2) + "\n")
    if not (BUNDLE / "pins.json").exists():
        (BUNDLE / "pins.json").write_text("[]\n")
    print(f"wrote {BUNDLE}/  {z.shape} px, z {z_min:.1f} .. {z_max:.1f} m around origin z0={z0:.1f} m, "
          f"lon {lon:.4f} lat {lat:.4f}")

    # self-check: decoding terrain.png the way the viewer does gives the DEM back
    back = z_min + np.asarray(Image.open(BUNDLE / "terrain.png"), dtype=np.float64) / 65535 * (z_max - z_min)
    assert np.abs(back - z).max() <= (z_max - z_min) / 65535, "terrain.png does not decode to the DEM"
    assert abs(back[mid - 1:mid + 1, mid - 1:mid + 1].mean()) < 0.05, "site origin is not on the terrain surface"


if __name__ == "__main__":
    main()
