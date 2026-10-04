"""Step 2 of docs/moon-scene.md: the terrain horizon seen from every 20 m analysis cell.

  uv run --no-project --with rasterio --with skyfield --with pillow --with numpy python pipelines/moon/horizon.py          # about 3 minutes on 16 cores
  uv run --no-project --with rasterio --with skyfield --with pillow --with numpy python pipelines/moon/horizon.py --check  # self-check only

Output: data/moon/horizon.npy, float32 [cells_y, cells_x, 360], degrees above the local horizontal.
  Row 0 is the north edge (same orientation as terrain.png). Index k is SITE azimuth k degrees: measured from
  site +Y (map grid north) clockwise towards site +X. See common.py for how that differs from true north.

Method: from each cell, OBSERVER_HEIGHT_M above the surface, march along each azimuth in the map plane, over
the 5 m DEM while the ray is inside it and the 80 m south-pole DEM beyond, out to MAX_DIST_M or the edge of the
80 m DEM (80 S; about 180 km to the north of the scene). Heights are sampled bilinearly. Curvature is exact
for a sphere rather than the d^2/2R approximation: stereographic map distance -> chord -> central angle.
"""
import sys
import time
from multiprocessing import get_context

import numpy as np

from common import CENTER_MAP, DATA, DEM_5M, DEM_FAR, OBSERVER_HEIGHT_M, R_MOON, cell_centres

MAX_DIST_M = 300_000.0
# 5 m steps out to 1 km, then steps of 0.5% of the distance.
# ponytail: point samples, so a knife-edge crest between two samples can be missed by up to
# 0.25% of the distance times its slope (under 0.1 deg of horizon). Halve GROWTH if that matters.
GROWTH = 1.005
_near = np.arange(5.0, 1000.0, 5.0)
DISTS = np.concatenate([_near, 1000.0 * GROWTH ** np.arange(np.log(MAX_DIST_M / 1000.0) / np.log(GROWTH))])


class Dem:
    """A north-up height grid in map metres. x0, y1 are the outer edges of the top-left pixel."""

    def __init__(self, z, x0, y1, res):
        self.z, self.x0, self.y1, self.res = z, x0, y1, res
        self.h, self.w = z.shape

    def pixel(self, x, y):
        """Fractional (col, row) in pixel-centre coordinates."""
        return (x - self.x0) / self.res - 0.5, (self.y1 - y) / self.res - 0.5

    def inside(self, x, y):
        c, r = self.pixel(x, y)
        return (c >= 0) & (c <= self.w - 1) & (r >= 0) & (r <= self.h - 1)

    def sample(self, x, y):
        """Bilinear height. Points outside are clamped to the edge: mask them with inside()."""
        c, r = self.pixel(x, y)
        c0 = np.clip(np.floor(c), 0, self.w - 2).astype(np.intp)
        r0 = np.clip(np.floor(r), 0, self.h - 2).astype(np.intp)
        tx, ty = np.clip(c - c0, 0, 1), np.clip(r - r0, 0, 1)
        z = self.z
        return ((z[r0, c0] * (1 - tx) + z[r0, c0 + 1] * tx) * (1 - ty)
                + (z[r0 + 1, c0] * (1 - tx) + z[r0 + 1, c0 + 1] * tx) * ty)


def tan_elevation(q0, r0, dist_map, x, y, z):
    """Tangent of the elevation angle of terrain point (x, y, z) seen from an observer at radius r0.
    q = 1 + rho^2 / 4R^2 is the squared stereographic scale term, so chord = map distance / sqrt(q0 q1)."""
    q1 = 1 + (x * x + y * y) / (4 * R_MOON ** 2)
    cos_t = 1 - dist_map ** 2 / (q0 * q1) / (2 * R_MOON ** 2)    # central angle from the chord on the sphere
    r1 = R_MOON + z
    return (r1 * cos_t - r0) / (r1 * np.sqrt(1 - cos_t * cos_t))


def one_azimuth(az_deg):
    """Horizon elevation (degrees) of every observer in _OBS along one site azimuth."""
    near, far, ox, oy, q0, r0 = _OBS
    ux, uy = np.sin(np.radians(az_deg)), np.cos(np.radians(az_deg))
    best = np.full(ox.shape, -np.inf)
    for d in DISTS:
        x, y = ox + d * ux, oy + d * uy
        ins = near.inside(x, y)
        if ins.all():
            z, ok = near.sample(x, y), None
        else:
            ok = far.inside(x, y)
            if not ok.any():
                break                                   # every ray has left the far DEM
            z = np.where(ins, near.sample(x, y), far.sample(x, y)) if ins.any() else far.sample(x, y)
        t = tan_elevation(q0, r0, d, x, y, z)
        np.maximum(best, t if ok is None else np.where(ok | ins, t, -np.inf), out=best)
    return np.degrees(np.arctan(best)).astype(np.float32)


def horizons(near, far, ox, oy, azimuths, workers=None):
    """[n_observers, n_azimuths] horizon elevations for observers at map (ox, oy), on the surface of `near`."""
    global _OBS
    r0 = R_MOON + near.sample(ox, oy) + OBSERVER_HEIGHT_M
    _OBS = (near, far, ox, oy, 1 + (ox * ox + oy * oy) / (4 * R_MOON ** 2), r0)
    with get_context("fork").Pool(workers) as pool:      # fork: workers share the DEMs without copying
        return np.stack(pool.map(one_azimuth, azimuths), axis=1)


def self_check():
    """A cone on a flat plain: towards the apex the horizon is the apex; away from it, the dip of the plain."""
    res, n, height, base = 5.0, 1201, 500.0, 1000.0
    dist = DISTS[np.argmin(abs(DISTS - 2000.0))]                 # a marched distance, so one sample lands on the apex
    x0, y1 = -3000.0, 123000.0                                   # near the real site, so the map scale is exercised
    cx, cy = x0 + n * res / 2, y1 - n * res / 2                  # n is odd: the apex is a pixel centre
    px, py = np.meshgrid(x0 + (np.arange(n) + 0.5) * res, y1 - (np.arange(n) + 0.5) * res)
    cone = Dem(np.maximum(0.0, height * (1 - np.hypot(px - cx, py - cy) / base)), x0, y1, res)
    plain = Dem(np.zeros((400, 400)), -400_000.0, 400_000.0, 2000.0)
    h = horizons(cone, plain, np.array([cx - dist]), np.array([cy]), [90.0, 270.0, 0.0], workers=3)[0]   # observer due west
    true = dist / (1 + (cx * cx + cy * cy) / (4 * R_MOON ** 2))  # ground distance: map distance over the local map scale
    expect = np.degrees(np.arctan((height - true ** 2 / (2 * R_MOON) - OBSERVER_HEIGHT_M) / true))
    dip = -np.degrees(np.sqrt(2 * OBSERVER_HEIGHT_M / R_MOON))
    assert abs(h[0] - expect) < 0.005, (h[0], expect)            # east: the apex
    assert abs(h[1] - dip) < 0.01 and abs(h[2] - dip) < 0.01, (h, dip)   # west and north: open plain
    print(f"ok: cone apex {h[0]:.3f} deg (expected {expect:.3f}), open plain {h[1]:.3f} deg (dip {dip:.3f})")


def main():
    import rasterio
    with rasterio.open(DEM_5M) as ds:
        near = Dem(ds.read(1).astype(np.float64), ds.bounds.left, ds.bounds.top, ds.res[0])
    with rasterio.open(DEM_FAR) as ds:
        far = Dem(ds.read(1), ds.bounds.left, ds.bounds.top, ds.res[0])
    assert np.isfinite(near.z).all() and np.isfinite(far.z).all(), "DEM has holes"
    # the two DEMs must share a height datum, or the horizon jumps where rays cross from one to the other
    step = round(far.res / near.res)
    skip_c = round((-(near.x0 - far.x0) % far.res) / near.res)   # 5 m pixels to drop to reach an 80 m pixel edge
    skip_r = round((-(far.y1 - near.y1) % far.res) / near.res)
    m = (min(near.h - skip_r, near.w - skip_c) // step) * step
    pooled = near.z[skip_r:skip_r + m, skip_c:skip_c + m].reshape(m // step, step, m // step, step).mean((1, 3))
    c, r = far.pixel(near.x0 + skip_c * near.res + far.res / 2, near.y1 - skip_r * near.res - far.res / 2)
    assert abs(c - round(c)) < 1e-6 and abs(r - round(r)) < 1e-6, "DEM grids are not aligned"
    diff = pooled - far.z[round(r):round(r) + m // step, round(c):round(c) + m // step]
    print(f"5 m DEM minus 80 m DEM over the overlap: mean {diff.mean():+.2f} m, std {diff.std():.2f} m")
    assert abs(diff.mean()) < 5 and diff.std() < 15, "the two DEMs disagree"

    x, y = cell_centres()
    print(f"{x.size} cells x 360 azimuths x up to {DISTS.size} steps, out to {MAX_DIST_M / 1000:.0f} km ...")
    t0 = time.time()
    h = horizons(near, far, x.ravel(), y.ravel(), np.arange(360.0)).reshape(*x.shape, 360)
    np.save(DATA / "horizon.npy", h)
    mid = h[h.shape[0] // 2, h.shape[1] // 2]
    print(f"wrote {DATA}/horizon.npy {h.shape} in {time.time() - t0:.0f} s. all cells: {h.min():.2f} .. {h.max():.2f} deg; "
          f"scene centre: {mid.min():.2f} .. {mid.max():.2f} deg, mean {mid.mean():.2f}")
    print(f"scene centre map {CENTER_MAP}: geometric dip of a smooth sphere from there would be "
          f"{-np.degrees(np.arccos(R_MOON / (R_MOON + near.sample(*map(np.array, CENTER_MAP)) + OBSERVER_HEIGHT_M))):.2f} deg")


if __name__ == "__main__":
    self_check()
    if "--check" not in sys.argv:
        main()
