"""Step 3 of docs/moon-scene.md: where the Sun and the Earth are, seen from the Moon, over the sampled period.

  uv run --no-project --with rasterio --with skyfield --with pillow --with numpy python pipelines/moon/ephemeris.py

Output (data/moon/):
  ephemeris.npz   jd_tt [N]; sun_km, earth_km [N, 3]: positions from the Moon's centre in the Moon-fixed
                  MOON_ME_DE421 frame (the frame of the LOLA DEMs). Light-time corrected, no aberration (under 0.01 deg).
  sun_azel.npy, earth_azel.npy   [N, 3] at the scene centre: TRUE azimuth (from north, clockwise), elevation,
                  angular radius, in degrees. maps.py recomputes these per cell from ephemeris.npz.

Sampling: START_UTC, every STEP_HOURS, N_SAMPLES samples (one Earth year; 12.4 lunar days).
"""
import numpy as np
import rasterio
from skyfield.api import Loader, PlanetaryConstants

from common import CENTER_MAP, DATA, DEM_5M, OBSERVER_HEIGHT_M, R_MOON, local_axes, map_to_lonlat

START_UTC = (2027, 1, 1)
STEP_HOURS = 6
N_SAMPLES = 1460
R_SUN_KM = 695_700.0     # IAU 2015 nominal solar radius
R_EARTH_KM = 6_371.0     # mean radius: Earth's disc is treated as a circle


def azel(body_km, lon, lat, radius_m, body_radius_km):
    """True azimuth, elevation and angular radius (degrees) of a body from surface points.
    body_km [N, 3] Moon-fixed; lon, lat (radians) and radius_m (from the Moon's centre) of shape [...].
    Returns three arrays of shape [N, ...]."""
    east, north, up = local_axes(lon, lat)
    d = body_km[(slice(None),) + (None,) * np.ndim(lon)] - up * (np.asarray(radius_m)[..., None] / 1000.0)
    dist = np.linalg.norm(d, axis=-1)
    e, n, u = (d * east).sum(-1), (d * north).sum(-1), (d * up).sum(-1)
    return (np.degrees(np.arctan2(e, n)) % 360, np.degrees(np.arcsin(u / dist)),
            np.degrees(np.arcsin(body_radius_km / dist)))


def main():
    load = Loader(str(DATA))
    ts = load.timescale()                      # built-in time data, no download
    eph = load("de421.bsp")
    pc = PlanetaryConstants()
    pc.read_text(load("moon_080317.tf"))
    pc.read_text(load("pck00008.tpc"))
    pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
    frame = pc.build_frame_named("MOON_ME_DE421")
    t = ts.utc(*START_UTC, np.arange(N_SAMPLES) * STEP_HOURS)
    moon = eph["moon"]
    sun_km = moon.at(t).observe(eph["sun"]).frame_xyz(frame).km.T
    earth_km = moon.at(t).observe(eph["earth"]).frame_xyz(frame).km.T

    with rasterio.open(DEM_5M) as ds:
        z0 = float(next(ds.sample([CENTER_MAP]))[0])
    lon, lat = map_to_lonlat(*CENTER_MAP)
    radius_m = R_MOON + z0 + OBSERVER_HEIGHT_M
    sun = np.stack(azel(sun_km, lon, lat, radius_m, R_SUN_KM), 1)
    earth = np.stack(azel(earth_km, lon, lat, radius_m, R_EARTH_KM), 1)

    # self-check against skyfield's own surface observer (an independent path through the frame maths)
    assert abs(pc.variables["BODY301_RADII"][0] * 1000 - R_MOON) < 1, "kernel Moon radius differs from the DEM sphere"
    here = moon + pc.build_latlon_degrees(frame, np.degrees(lat), np.degrees(lon), elevation_m=z0 + OBSERVER_HEIGHT_M)
    for name, body, mine in (("sun", eph["sun"], sun), ("earth", eph["earth"], earth)):
        alt, az, _ = here.at(t).observe(body).apparent().altaz()
        d_el = np.abs(alt.degrees - mine[:, 1]).max()
        d_az = np.abs(((az.degrees - mine[:, 0] + 180) % 360 - 180) * np.cos(np.radians(mine[:, 1]))).max()
        print(f"{name}: max difference from skyfield altaz: elevation {d_el:.4f} deg, azimuth {d_az:.4f} deg")
        assert d_el < 0.02 and d_az < 0.02, "local east/north/up maths disagrees with skyfield"

    np.savez(DATA / "ephemeris.npz", jd_tt=t.tt, sun_km=sun_km, earth_km=earth_km,
             start_utc=t[0].utc_iso(), end_utc=t[-1].utc_iso(), step_hours=STEP_HOURS)
    np.save(DATA / "sun_azel.npy", sun)
    np.save(DATA / "earth_azel.npy", earth)
    print(f"{N_SAMPLES} samples every {STEP_HOURS} h, {t[0].utc_iso()} .. {t[-1].utc_iso()}, scene centre "
          f"lon {np.degrees(lon):.4f} lat {np.degrees(lat):.4f}")
    print(f"sun   elevation {sun[:, 1].min():+.2f} .. {sun[:, 1].max():+.2f} deg, radius {sun[:, 2].min():.3f} .. {sun[:, 2].max():.3f} deg, "
          f"azimuth covers {np.unique(sun[:, 0].astype(int) // 10).size * 10} of 360 deg")
    az = (earth[:, 0] + 180) % 360 - 180
    print(f"earth elevation {earth[:, 1].min():+.2f} .. {earth[:, 1].max():+.2f} deg, true azimuth {az.min():+.2f} .. {az.max():+.2f} deg, "
          f"radius {earth[:, 2].min():.3f} .. {earth[:, 2].max():.3f} deg")
    # the Moon's spin axis is tilted about 1.5 deg to the ecliptic: at 86 S the Sun never climbs high, and it
    # goes right round the horizon; the Earth only librates about a fixed direction (north, towards lon 0)
    assert np.abs(sun[:, 1]).max() < 90 + np.degrees(lat) + 2.0, "Sun too far from the horizon: frame setup is wrong"
    assert np.unique(sun[:, 0].astype(int) // 10).size == 36, "Sun does not go round the horizon"
    assert np.abs(az).max() < 12 and earth[:, 1].max() - earth[:, 1].min() < 16, "Earth is not hovering"


if __name__ == "__main__":
    main()
