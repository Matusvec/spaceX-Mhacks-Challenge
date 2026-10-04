"""Steps 4 to 6 of docs/moon-scene.md: turn the horizon profiles and the Sun/Earth positions into rasters.

  uv run --no-project --with rasterio --with skyfield --with pillow --with numpy python pipelines/moon/maps.py   # about 10 s

Needs data/moon/horizon.npy (horizon.py) and data/moon/ephemeris.npz (ephemeris.py). Writes into the bundle:
  rasters/illumination_pct.png   mean fraction of the Sun's disc above the terrain horizon, as a percentage
  rasters/earth_visible_pct.png  the same for the Earth's disc (direct-to-Earth line of sight)
  rasters/dose_estimate.png      ESTIMATE: cosmic-ray dose scaled by how much sky the terrain leaves open
  sky/sun_azel.json, sky/earth_azel.json   positions at the scene centre for the viewer to animate
"""
import json

import numpy as np
import rasterio

from common import BUNDLE, CENTER_MAP, DATA, DEM_5M, OBSERVER_HEIGHT_M, R_MOON, cell_centres, map_to_lonlat, write_raster
from ephemeris import R_EARTH_KM, R_SUN_KM, azel

# Chang'e 4 LND, dose equivalent on the lunar surface (Zhang et al. 2020, Science Advances): docs/data-sources.md
BASELINE_USV_PER_DAY = 1369.0
BASELINE_URL = "https://www.science.org/doi/10.1126/sciadv.aaz1334"
CHUNK = 100   # time samples per batch, to keep arrays around 100 MB


def disc_fraction(el, horizon, radius):
    """Fraction of a disc's area above a horizon line: centre at elevation `el`, same units throughout.
    ponytail: the horizon is taken as level across the disc, at the height under the disc's centre.
    Fine for the Sun (0.5 deg wide, 1 deg bins); for the Earth (2 deg wide) slice the disc if it matters."""
    x = np.clip((el - horizon) / radius, -1.0, 1.0)
    return 0.5 + (x * np.sqrt(1 - x * x) + np.arcsin(x)) / np.pi


def horizon_at(horizon, site_az):
    """Horizon [Y, X, 360] looked up at site azimuths [T, Y, X] (degrees), linear between the 1 deg bins."""
    a = np.moveaxis(site_az % 360, 0, -1)
    i0 = np.floor(a).astype(np.intp) % 360
    f = a - np.floor(a)
    h = np.take_along_axis(horizon, i0, 2) * (1 - f) + np.take_along_axis(horizon, (i0 + 1) % 360, 2) * f
    return np.moveaxis(h, -1, 0)


def visible_fraction(horizon, body_km, body_radius_km, lon, lat, radius_m):
    """[T, Y, X] fraction of the body's disc above the horizon at every time sample and cell."""
    out = np.empty((len(body_km),) + lon.shape, np.float32)
    for i in range(0, len(body_km), CHUNK):
        az, el, rad = azel(body_km[i:i + CHUNK], lon, lat, radius_m, body_radius_km)
        out[i:i + CHUNK] = disc_fraction(el, horizon_at(horizon, az + np.degrees(lon)), rad)   # true -> site azimuth
    return out


def open_sky_factor(horizon):
    """f in moon-scene.md step 6: open solid angle above the horizon over that of flat ground (h = 0 gives 1)."""
    return (1 - np.sin(np.radians(horizon))).mean(-1)


def self_check():
    flat = np.zeros((2, 2, 360), np.float32)
    el = np.array([-0.5, -0.27, -0.1, 0.0, 0.1, 0.27, 0.5])
    f = disc_fraction(el, 0.0, 0.27)
    assert f[0] == 0 and f[-1] == 1 and abs(f[3] - 0.5) < 1e-12 and (np.diff(f) >= 0).all()
    assert ((f > 0.5) == (el > 0)).all(), "a flat plain must see the Sun's centre exactly when its elevation is positive"
    assert abs(f[2] + f[4] - 1) < 1e-12                                       # symmetric about the horizon
    assert np.allclose(open_sky_factor(flat), 1.0) and open_sky_factor(flat + 30)[0, 0] < 0.51
    ramp = np.broadcast_to(np.arange(360.0), (2, 2, 360))
    assert np.allclose(horizon_at(ramp, np.full((1, 2, 2), 10.25)), 10.25)     # interpolation between bins
    assert np.allclose(horizon_at(ramp, np.full((1, 2, 2), -0.5)), 179.5)      # wraps: halfway between bin 359 and bin 0
    print("ok: disc fraction, open-sky factor and horizon lookup")


def sky_json(name, body_azel, lon_c, frac_centre, eph):
    """sky/<name>_azel.json: the time series at the scene centre, in site azimuth."""
    out = {
        "body": name, "start_utc": str(eph["start_utc"]), "end_utc": str(eph["end_utc"]),
        "step_hours": int(eph["step_hours"]), "samples": len(body_azel),
        "frame": "az_site_deg is measured from site +Y clockwise towards site +X; el_deg is above the local horizontal. "
                 "Unit vector in the site frame: (sin az cos el, cos az cos el, sin el).",
        "angular_radius_deg": round(float(body_azel[:, 2].mean()), 3),
        "az_site_deg": np.round((body_azel[:, 0] + np.degrees(lon_c)) % 360, 2).tolist(),
        "el_deg": np.round(body_azel[:, 1], 2).tolist(),
        "visible_fraction_center": np.round(frac_centre.astype(float), 3).tolist(),
        "source": "JPL DE421 via skyfield, MOON_ME frame; visibility from the LOLA terrain horizon at the 20 m cell nearest the centre",
    }
    (BUNDLE / "sky").mkdir(parents=True, exist_ok=True)
    (BUNDLE / "sky" / f"{name}_azel.json").write_text(json.dumps(out) + "\n")


def main():
    horizon = np.load(DATA / "horizon.npy")
    eph = np.load(DATA / "ephemeris.npz")
    x, y = cell_centres()
    assert horizon.shape == x.shape + (360,), "horizon.npy does not match the analysis grid: re-run horizon.py"
    lon, lat = map_to_lonlat(x, y)
    with rasterio.open(DEM_5M) as ds:      # cell centres sit on pixel corners: nearest pixel is within 0.4 m of height
        z = np.array([v[0] for v in ds.sample(zip(x.ravel(), y.ravel()))]).reshape(x.shape)
    radius_m = R_MOON + z + OBSERVER_HEIGHT_M
    lon_c = map_to_lonlat(*CENTER_MAP)[0]
    mid = (x.shape[0] // 2, x.shape[1] // 2)
    sampling = {"start_utc": str(eph["start_utc"]), "end_utc": str(eph["end_utc"]),
                "step_hours": int(eph["step_hours"]), "samples": len(eph["jd_tt"])}
    common = {"resolution": "20 m/px", "observer_height_m": OBSERVER_HEIGHT_M}
    horizon_note = ("terrain horizon from LOLA 5 m/px DEM (Site 23) and LOLA 80 m/px south pole DEM out to 300 km "
                    "or 80 S, 1 deg azimuth bins")

    for name, key, body_r, label in (("sun", "sun_km", R_SUN_KM, "illumination_pct"),
                                     ("earth", "earth_km", R_EARTH_KM, "earth_visible_pct")):
        frac = visible_fraction(horizon, eph[key], body_r, lon, lat, radius_m)
        what = "Sun's" if name == "sun" else "Earth's"
        write_raster(label, 100.0 * frac.mean(0), 0.0, 100.0, 8, unit="%",
                     source=f"computed from LOLA DEMs + JPL DE421 ephemeris: {horizon_note}",
                     estimate=False, sampling=sampling, **common,
                     description=f"mean fraction of the {what} disc above the terrain horizon over the sampled period")
        sky_json(name, np.load(DATA / f"{name}_azel.npy"), lon_c, frac[:, mid[0], mid[1]], eph)
        print(f"  scene centre cell: {100 * frac[:, mid[0], mid[1]].mean():.1f} %")

    baseline = BASELINE_USV_PER_DAY * 365.25 / 1000.0          # mSv per year on flat open ground
    f = open_sky_factor(horizon)
    dose = baseline * f
    write_raster("dose_estimate", dose, float(np.floor(dose.min())), float(np.ceil(dose.max())), 16, unit="mSv/yr",
                 source=f"ESTIMATE. Chang'e 4 surface measurement ({BASELINE_USV_PER_DAY:.0f} uSv/day dose equivalent) "
                        f"scaled by open-sky fraction from the {horizon_note}",
                 source_url=BASELINE_URL, estimate=True, baseline_mSv_per_year=round(baseline, 1), **common,
                 description="unshielded surface dose, first-order: isotropic cosmic rays scaled by the solid angle of open sky "
                             "relative to flat ground. Ignores secondary neutrons, solar particle events and habitat shielding. "
                             "For comparing sites, not for medical dose planning.")
    print(f"  open-sky factor {f.min():.3f} .. {f.max():.3f}, baseline {baseline:.1f} mSv/yr")

    manifest = BUNDLE / "scene.json"
    scene = json.loads(manifest.read_text())
    scene["sky"] = {"sun": "sky/sun_azel.json", "earth": "sky/earth_azel.json", **sampling}
    manifest.write_text(json.dumps(scene, indent=2) + "\n")


if __name__ == "__main__":
    self_check()
    main()
