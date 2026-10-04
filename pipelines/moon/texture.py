"""Stand-in terrain texture: shaded relief COMPUTED from the LOLA 5 m DEM. It is not an image of the surface.
(The LROC NAC mosaic of docs/moon-scene.md step 1.3 is not downloaded; replace this file when it is.)

  uv run --no-project --with rasterio --with skyfield --with pillow --with numpy python pipelines/moon/texture.py

Needs data/moon/sun_azel.npy (ephemeris.py) and scenes/moon-malapert-01/scene.json (build_terrain.py).
Output: scenes/moon-malapert-01/terrain_texture.jpg, same extent and orientation as terrain.png, and the
terrain.texture / terrain.texture_info / sources entries in scene.json.

Lighting: the Sun direction of one real sample of the 2027 series: of the samples within 5 deg of north-west
(site azimuth 315, the usual direction for readable relief), the one with the highest Sun.
Brightness is linear in cos(angle between surface normal and Sun), stretched between its 0.5 and 99.5
percentiles and NOT clipped at zero: slopes facing away from the Sun are darker, not black, and there are no
cast shadows. So it shows the shape of the ground; it is not a rendering of what the site looks like then.
"""
import json
from datetime import datetime, timedelta

import numpy as np
from PIL import Image

from build_terrain import crop
from common import BUNDLE, CENTER_MAP, DATA, DEM_5M, RES_M, URL_5M, map_to_lonlat

TEXTURE_PX = 2048
LIGHT_SITE_AZ = 315.0
SOURCE_NAME = "Terrain texture: shaded relief computed from the LOLA 5 m/px DEM (not an image of the surface)"


def cos_incidence(z, res_m, site_az_deg, el_deg):
    """cos of the angle between the surface normal and the Sun, per pixel. z has row 0 = north; site azimuth."""
    d_south, d_east = np.gradient(z, res_m)
    az, el = np.radians(site_az_deg), np.radians(el_deg)
    sun = np.array([np.sin(az) * np.cos(el), np.cos(az) * np.cos(el), np.sin(el)])   # east, north, up
    return (-d_east * sun[0] + d_south * sun[1] + sun[2]) / np.sqrt(1 + d_east ** 2 + d_south ** 2)


def self_check():
    yy, xx = np.mgrid[0:50, 0:50] * 5.0
    flat = cos_incidence(np.zeros((50, 50)), 5.0, 315.0, 4.0)
    assert np.allclose(flat, np.sin(np.radians(4.0)))                                   # flat ground: sin(elevation)
    rises_east = cos_incidence(xx * np.tan(np.radians(10)), 5.0, 90.0, 4.0)             # 10 deg slope facing west
    assert np.allclose(rises_east, np.sin(np.radians(4.0 - 10.0)))                      # Sun in the east: 6 deg behind it
    rises_south = cos_incidence(yy * np.tan(np.radians(10)), 5.0, 0.0, 4.0)             # row index grows southwards
    assert np.allclose(rises_south, np.sin(np.radians(4.0 + 10.0)))                     # faces north, Sun in the north
    print("ok: shading of flat ground and of 10 deg slopes facing towards and away from the Sun")


def main():
    sun = np.load(DATA / "sun_azel.npy")                       # true azimuth, elevation at the scene centre
    eph = np.load(DATA / "ephemeris.npz")
    site_az = (sun[:, 0] + np.degrees(map_to_lonlat(*CENTER_MAP)[0])) % 360
    near_nw = np.flatnonzero(np.abs((site_az - LIGHT_SITE_AZ + 180) % 360 - 180) < 5)
    i = int(near_nw[np.argmax(sun[near_nw, 1])])
    utc = (datetime.fromisoformat(str(eph["start_utc"]).replace("Z", "+00:00"))
           + timedelta(hours=i * int(eph["step_hours"]))).strftime("%Y-%m-%dT%H:%M:%SZ")

    c = cos_incidence(crop(DEM_5M), RES_M, site_az[i], sun[i, 1])
    lo, hi = np.percentile(c, [0.5, 99.5])
    grey = np.clip((c - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)
    Image.fromarray(grey).resize((TEXTURE_PX, TEXTURE_PX), Image.BICUBIC).save(BUNDLE / "terrain_texture.jpg", quality=90)

    manifest = BUNDLE / "scene.json"
    scene = json.loads(manifest.read_text())
    scene["terrain"]["texture"] = "terrain_texture.jpg"
    scene["terrain"]["texture_info"] = {
        "kind": "computed shaded relief, not an image of the surface",
        "source": "NASA PGDA LOLA 5 m/px DEM, Site 23 (Malapert massif)", "resolution": "5 m/px DEM, upsampled to "
        f"{TEXTURE_PX} px",
        "light": {"sample_index": i, "utc": utc, "sun_site_azimuth_deg": round(float(site_az[i]), 2),
                  "sun_elevation_deg": round(float(sun[i, 1]), 2)},
        "note": "Sun direction is a real sample of the 2027 series at the scene centre. Brightness is linear in the cosine "
                "between surface normal and Sun, contrast-stretched and not clipped at zero; no cast shadows. "
                "It shows terrain shape, not what the site looks like at that time.",
    }
    scene["sources"] = [s for s in scene["sources"] if s["name"] != SOURCE_NAME] + [{"name": SOURCE_NAME, "url": URL_5M}]
    manifest.write_text(json.dumps(scene, indent=2) + "\n")
    print(f"wrote {BUNDLE}/terrain_texture.jpg {TEXTURE_PX} px. light: sample {i} ({utc}), site azimuth {site_az[i]:.2f}, "
          f"elevation {sun[i, 1]:.2f} deg; cos stretched {lo:.3f} .. {hi:.3f}")


if __name__ == "__main__":
    self_check()
    main()
