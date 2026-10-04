"""Shared constants and geometry for the Malapert scene: where the scene is, the map <-> Moon
conversions, and the raster writer. Imported by the other scripts in this folder.

Self-check (compares the projection maths here with PROJ, using the DEM's own GeoTIFF tags):

  uv run --no-project --with rasterio --with skyfield --with pillow --with numpy python pipelines/moon/common.py

Frames (docs/contracts.md section 1):
  map   south polar stereographic metres, true scale at the pole, sphere R = 1,737,400 m, MOON_ME (DE421).
        x = rho sin(lon), y = rho cos(lon), so +y points along longitude 0, towards the Earth side.
  site  site = map - CENTER_MAP. Axes are the map grid axes, NOT rotated to true north: at the scene
        centre (lon 2.12 E) site +Y points 2.12 deg west of true north. All azimuths written to the
        bundle are "site azimuths": measured from site +Y, clockwise towards site +X.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

R_MOON = 1_737_400.0            # m, the sphere both LOLA DEMs are projected on and measured from
SCENE_ID = "moon-malapert-01"
# Chosen by eye from the LOLA slope map: the broad low-slope summit plateau of Malapert massif.
# The 4 km window holds the plateau, the summit (5,174 m), and the top of the north and south faces.
CENTER_MAP = (4500.0, 121800.0)  # m, map x, y
SIZE_M = 4000.0                  # scene is SIZE_M square, centred on CENTER_MAP
RES_M = 5.0                      # terrain.png and slope raster (LOLA Site 23 grid)
CELL_M = 20.0                    # analysis grid for horizon, illumination, Earth visibility, dose
OBSERVER_HEIGHT_M = 2.0          # horizons are evaluated this far above the surface (mast / panel height)

DATA = Path("data/moon")
BUNDLE = Path("scenes") / SCENE_ID
DEM_5M = DATA / "Site23_final_adj_5mpp_surf.tif"
SLOPE_5M = DATA / "Site23_final_adj_5mpp_slp.tif"
DEM_FAR = DATA / "LDEM_80S_80MPP_ADJ.TIF"
URL_5M = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site23/"
URL_FAR = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF"


def map_to_lonlat(x, y):
    """Map metres -> (lon, lat) in radians on the sphere."""
    rho = np.hypot(x, y)
    return np.arctan2(x, y), 2 * np.arctan(rho / (2 * R_MOON)) - np.pi / 2


def local_axes(lon, lat):
    """Unit vectors (east, north, up) in the Moon-fixed frame at lon, lat (radians). Shape [..., 3]."""
    sl, cl, sp, cp = np.sin(lon), np.cos(lon), np.sin(lat), np.cos(lat)
    zero = np.zeros_like(sl)
    return (np.stack([-sl, cl, zero], -1), np.stack([-sp * cl, -sp * sl, cp], -1),
            np.stack([cp * cl, cp * sl, sp], -1))


def cell_centres(cell_m=CELL_M):
    """Map x, y of every analysis cell centre. Row 0 is the north edge, as in terrain.png."""
    n = round(SIZE_M / cell_m)
    off = (np.arange(n) + 0.5) * cell_m - SIZE_M / 2
    x, y = np.meshgrid(CENTER_MAP[0] + off, CENTER_MAP[1] - off)
    return x, y


def write_raster(name, values, vmin, vmax, bits, **meta):
    """Write rasters/<name>.png and add or replace its entry in rasters/index.json.
    Decoding: value = min + pixel / (2**bits - 1) * (max - min)."""
    out = BUNDLE / "rasters"
    out.mkdir(parents=True, exist_ok=True)
    top = 2 ** bits - 1
    assert np.isfinite(values).all() and values.min() >= vmin and values.max() <= vmax, name
    px = np.round((values - vmin) / (vmax - vmin) * top).astype(np.uint16 if bits == 16 else np.uint8)
    Image.fromarray(px).save(out / f"{name}.png")
    index = out / "index.json"
    entries = json.loads(index.read_text()) if index.exists() else []
    entry = {"name": name, "file": f"{name}.png", "bits": bits, "min": vmin, "max": vmax, **meta}
    entries = [e for e in entries if e["name"] != name] + [entry]
    index.write_text(json.dumps(entries, indent=2) + "\n")
    print(f"wrote rasters/{name}.png  {values.shape}  range {values.min():.3f} .. {values.max():.3f} {meta.get('unit', '')}")


if __name__ == "__main__":
    import rasterio
    from rasterio.warp import transform

    with rasterio.open(DEM_5M) as near, rasterio.open(DEM_FAR) as far:
        assert near.crs.to_dict() == far.crs.to_dict(), "the two DEMs are not in the same projection"
        proj = near.crs.to_dict()
        assert proj["proj"] == "stere" and proj["lat_0"] == -90 and proj["lon_0"] == 0 and proj["R"] == R_MOON, proj
        xs, ys = np.array([4500.0, -11000.0, 250000.0, 0.0]), np.array([121800.0, 111000.0, -180000.0, 300000.0])
        geographic = rasterio.crs.CRS.from_proj4(f"+proj=longlat +R={R_MOON} +no_defs")
        lon_ref, lat_ref = transform(near.crs, geographic, xs, ys)
    lon, lat = map_to_lonlat(xs, ys)
    assert np.allclose(np.degrees(lon), lon_ref, atol=1e-7) and np.allclose(np.degrees(lat), lat_ref, atol=1e-7)
    e, n, u = local_axes(lon, lat)
    assert np.allclose(np.cross(e, n), u) and np.allclose(u[3], [np.cos(lat[3]), 0, np.sin(lat[3])])
    print(f"ok: projection matches PROJ. scene centre lon {np.degrees(lon[0]):.4f} E, lat {np.degrees(lat[0]):.4f}")
