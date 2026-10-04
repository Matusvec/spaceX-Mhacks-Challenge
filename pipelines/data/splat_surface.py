#!/usr/bin/env python3
"""Height map of the splat's own surface, so things in the viewer can stand on the rocks it shows.

  python3 pipelines/data/splat_surface.py scenes/mars-hero-01

The orbital elevation model is 1 m per pixel: a 40 cm rock is not in it, so a rover placed on it
drives through every rock the splat shows. This grids the exported Gaussians (splat.spz, site frame)
into CELL_M cells and takes a high percentile of their heights as the surface, drops cells with too
few Gaussians, bridges pinholes, and rounds the result the way a wheel would feel it.

Writes <bundle>/splat_surface.png (16-bit grey, row 0 = north edge, pixel 0 = no data, otherwise
z = z_min_m + (pixel - 1) / 65534 * (z_max_m - z_min_m)) and scene.json["splat_surface"]. It is the
top of a reconstruction from rover photos, good to a few cm where the splat is dense: an estimate.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from export_scene import read_spz_xyz

CELL_M = 0.1
PERCENTILE = 0.8        # high enough to be the top of a rock, low enough to ignore the odd floater
MIN_PER_CELL = 4
WHEEL_CELLS = 3         # about 30 cm: a 52 cm wheel does not drop into gaps narrower than this


def surface(xyz, cell=CELL_M):
    """(heights [rows, cols] with NaN = no data, west edge x, north edge y)."""
    x0, y1 = xyz[:, 0].min(), xyz[:, 1].max()
    col = ((xyz[:, 0] - x0) / cell).astype(int)
    row = ((y1 - xyz[:, 1]) / cell).astype(int)
    rows, cols = row.max() + 1, col.max() + 1
    flat = row * cols + col
    order = np.lexsort((xyz[:, 2], flat))
    cells, start, count = np.unique(flat[order], return_index=True, return_counts=True)
    top = xyz[order, 2][start + np.floor(PERCENTILE * (count - 1)).astype(int)]
    z = np.full(rows * cols, np.nan)
    z[cells[count >= MIN_PER_CELL]] = top[count >= MIN_PER_CELL]
    z = z.reshape(rows, cols)
    for _ in range(2):   # bridge pinholes: an empty cell with most of its neighbours measured
        have = np.isfinite(z)
        near = ndimage.uniform_filter(have.astype(float), 3) * 9
        mean = ndimage.uniform_filter(np.where(have, z, 0.0), 3) * 9 / np.maximum(near, 1)
        z = np.where(~have & (near >= 5), mean, z)
    have = np.isfinite(z)
    filled = np.where(have, z, np.nanmin(z))
    rolled = ndimage.gaussian_filter(ndimage.grey_closing(filled, size=WHEEL_CELLS), 0.6)
    return np.where(have, rolled, np.nan), x0, y1


def main(bundle):
    bundle = Path(bundle)
    z, x0, y1 = surface(read_spz_xyz(bundle / "splat.spz").astype(np.float64))
    lo, hi = float(np.nanmin(z)), float(np.nanmax(z))
    pixels = np.where(np.isfinite(z), 1 + np.round((z - lo) / (hi - lo) * 65534), 0).astype(np.uint16)
    Image.fromarray(pixels).save(bundle / "splat_surface.png")
    rows, cols = z.shape
    scene = json.loads((bundle / "scene.json").read_text())
    scene["splat_surface"] = {
        "file": "splat_surface.png", "cell_m": CELL_M, "z_min_m": round(lo, 4), "z_max_m": round(hi, 4),
        "west_m": round(float(x0), 4), "north_m": round(float(y1), 4), "size_m": [round(cols * CELL_M, 4), round(rows * CELL_M, 4)],
        "estimate": True, "resolution": f"{CELL_M * 100:.0f} cm cells",
        "source": f"top of the splat: {PERCENTILE:.0%} height of the Gaussians in each cell, rounded over {WHEEL_CELLS * CELL_M * 100:.0f} cm"}
    (bundle / "scene.json").write_text(json.dumps(scene, indent=2) + "\n")
    print(f"splat_surface.png: {cols} x {rows} cells of {CELL_M} m, {np.isfinite(z).mean():.0%} with data, heights {lo:.2f} to {hi:.2f} m")


if __name__ == "__main__":
    # self-check: a tilted plane with a 0.4 m block on it, sampled densely, comes back within 3 cm
    _rng = np.random.default_rng(0)
    _xy = _rng.uniform(0, 4, (200000, 2))
    _block = (np.abs(_xy[:, 0] - 2) < 0.5) & (np.abs(_xy[:, 1] - 2) < 0.5)
    _z, _x0, _y1 = surface(np.c_[_xy, 0.1 * _xy[:, 0] + 0.4 * _block + _rng.normal(0, 0.005, len(_xy))])
    _at = lambda x, y: _z[int((_y1 - y) / CELL_M), int((x - _x0) / CELL_M)]
    assert abs(_at(2.0, 2.0) - 0.6) < 0.03 and abs(_at(0.5, 3.0) - 0.05) < 0.03, (_at(2.0, 2.0), _at(0.5, 3.0))
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
