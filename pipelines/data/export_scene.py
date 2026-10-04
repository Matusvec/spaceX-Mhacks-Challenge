#!/usr/bin/env python3
"""Turn a trained gsplat PLY into the splat half of a scene bundle (docs/contracts.md sections 2 and 3).

  python3 pipelines/data/export_scene.py runs/<run>/ply/point_cloud_29999.ply scenes/mars-hero-01 [frame.json]
  python3 pipelines/data/export_scene.py --self-check

Prunes and crops the splat, moves it from the training frame (the dataset's frame.json) to the scene's `site`
frame, settles it on the terrain heightmap, and writes splat.spz, layers.bin, layers.json and the "splat"
entry of scene.json. Record i of layers.bin belongs to Gaussian i of splat.spz, which is row kept_index[i]
of the PLY: <ply stem>.kept_index.npy is written beside the PLY. The file is SPZ version 3 (gzip), written
here so the order is ours to keep, in site coordinates with no RDF-to-RUB axis flip (Spark applies none).
"""
import gzip
import json
import math
import struct
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

FRAME_JSON = Path("data/colmap/cheyava_site/frame.json")
HERO_TRAIN_M = (0.69, 1.88)   # Cheyava Falls, east and north in the training frame
# Inside 9 m the splat holds about 2,500 Gaussians per m2, from 9 to 15 m about 460: speckle in the viewer.
CROP_RADIUS_M = 9.0           # the well-observed workspace (docs/splat-pipeline.md step 6); gives a clean disc
MIN_OPACITY = 0.05
MAX_SCALE_M = 1.0             # longest 1-sigma axis; anything larger is a floater
MAX_BELOW_GROUND_M = 0.5      # after settling on the terrain; the viewer's SPLAT_SINK_M (0.6) depends on it
MAX_ABOVE_GROUND_M = 5.0      # nothing in the workspace is taller; cuts sky floaters
MAX_Z_FIX_M = 1.0             # a larger vertical misfit means the frames are wrong, so stop
GROUND_CELL_M, ROUGHNESS_CELL_M = 1.0, 0.5   # the DTM's pixel size; the roughness layer's cell
SURFACE_CELL_M = 0.25         # grid for the splat's own surface (floater tests)
SURFACE_PERCENTILE = 0.3      # opacity-weighted fraction of a cell's Gaussians below its local ground
MAX_ABOVE_SURFACE_M = 0.35    # above the highest local ground of the 3 x 3 cells around: a floater
MAX_BELOW_SURFACE_M = 0.2     # below the lowest of them: buried, and it shines out through any hole nearby
DENSITY_WINDOW_CELLS = 15     # 3.75 m: wider than a rover-footprint hole is across
MIN_DENSITY_RATIO = 0.4       # thinner than this against the typical (median) cell in that window: no surface
R_MARS = 3396190.0            # sphere of the DTM's equirectangular projection (scene.json map_crs)
TERRAIN_IN_MAP_UNITS = True   # terrain.png is a window of DTM pixels; False once it is resampled to real metres
R_TRAIN_TO_SITE = np.eye(3)   # both frames are east-north-up, 4 m apart: no rotation between them
ANTIALIASED = True            # pipelines/colab/site.sh trains with --antialiased
SPZ_MAGIC, SPZ_VERSION, SPZ_FRAC_BITS = 0x5053474E, 3, 12   # 1/4096 m position steps
# Degree-1 SH coefficients (s0, s1, s2) weight (-y, z, -x) of the view direction: v = SH1_TO_XYZ @ s is a vector.
SH1_TO_XYZ = np.array([[0, 0, -1], [-1, 0, 0], [0, 1, 0]], float)
PLY_TYPES = {"float": "f4", "float32": "f4", "double": "f8", "float64": "f8", "uchar": "u1", "int": "i4"}


def load_ply(path):
    """Read a 3DGS PLY (gsplat export_splats): log scales, logit opacities, quaternions as w x y z."""
    with open(path, "rb") as f:
        lines = []
        while not lines or lines[-1] != "end_header":
            line = f.readline()
            if not line:
                raise SystemExit(f"{path}: no end_header, not a PLY")
            lines.append(line.decode("ascii").strip())
        if "format binary_little_endian 1.0" not in lines:
            raise SystemExit(f"{path}: only binary little-endian PLY is supported")
        n = int(next(l for l in lines if l.startswith("element vertex")).split()[2])
        props = [l.split()[1:] for l in lines if l.startswith("property")]
        data = np.frombuffer(f.read(), dtype=[(name, "<" + PLY_TYPES[kind]) for kind, name in props], count=n)
    def cols(names):
        return np.stack([data[c] for c in names], 1).astype(np.float32)
    n_rest = sum(name.startswith("f_rest_") for _, name in props)
    return {"xyz": cols("xyz").astype(np.float64), "dc": cols([f"f_dc_{i}" for i in range(3)]),
            # [N, rgb, coefficient]; a degree-0 splat has no f_rest_* at all
            "rest": (cols([f"f_rest_{i}" for i in range(n_rest)]) if n_rest else np.zeros((n, 0), np.float32)).reshape(n, 3, -1),
            "opacity": data["opacity"].astype(np.float32), "scale": cols([f"scale_{i}" for i in range(3)]),
            "quat": cols([f"rot_{i}" for i in range(4)])}


def rotate(g, R):
    """Rotate Gaussians by R: centres, orientations and the degree-1 SH band together."""
    from scipy.spatial.transform import Rotation
    assert g["rest"].shape[2] in (0, 3), "only SH degree 0 or 1 can be rotated here"
    quat = (Rotation.from_matrix(R) * Rotation.from_quat(g["quat"][:, [1, 2, 3, 0]])).as_quat()[:, [3, 0, 1, 2]]
    rest = g["rest"] @ (SH1_TO_XYZ.T @ R @ SH1_TO_XYZ).T if g["rest"].shape[2] else g["rest"]
    return {**g, "xyz": g["xyz"] @ R.T, "quat": quat.astype(np.float32), "rest": rest.astype(np.float32)}


def load_terrain(bundle, scene):
    """Return ground(east, north) -> (height, slope_deg) at site positions given in real metres.
    While TERRAIN_IN_MAP_UNITS, a pixel is `resolution_m` of the lat_ts=0 equirectangular map: that much
    north-south but times cos(lat) real metres east-west, and the site origin sits a fraction of a pixel
    off the window centre because the DTM grid is on whole map metres."""
    t, o = scene["terrain"], scene["site_origin_map"]
    z = t["z_min_m"] + np.asarray(Image.open(bundle / t["file"]), np.float64) / 65535 * (t["z_max_m"] - t["z_min_m"])
    res, cos_lat = t["resolution_m"], math.cos(o["y"] / R_MARS) if TERRAIN_IN_MAP_UNITS else 1.0
    off_col, off_row = ((o["x"] / res) % 1, (-o["y"] / res) % 1) if TERRAIN_IN_MAP_UNITS else (0.0, 0.0)
    d_north, d_east = np.gradient(z, res, res * cos_lat)
    slope = np.degrees(np.arctan(np.hypot(d_north, d_east)))
    rows, cols = z.shape

    def ground(east, north):
        col = cols / 2 + off_col + east / (res * cos_lat) - 0.5   # in pixel centres
        row = rows / 2 + off_row - north / res - 0.5               # row 0 is north
        c0 = np.clip(np.floor(col).astype(int), 0, cols - 2)
        r0 = np.clip(np.floor(row).astype(int), 0, rows - 2)
        fc, fr = col - c0, row - r0
        return tuple((grid[r0, c0] * (1 - fc) + grid[r0, c0 + 1] * fc) * (1 - fr)
                     + (grid[r0 + 1, c0] * (1 - fc) + grid[r0 + 1, c0 + 1] * fc) * fr for grid in (z, slope))
    return ground


def surface_tests(xyz, weight):
    """Floater tests against the splat's own surface, on a SURFACE_CELL_M grid. No holes are filled.
    Local ground is the opacity-weighted SURFACE_PERCENTILE of z in a cell, so a boulder's cells carry the
    boulder. Sparkles inside the rover-footprint holes sit at ground height; what marks them is that the
    3 x 3 cells around them hold little of what cells near the hole hold. A dense rim and the evenly
    sparse far ground both pass."""
    ij = np.floor((xyz[:, :2] - xyz[:, :2].min(0)) / SURFACE_CELL_M).astype(int)
    shape = tuple(ij.max(0) + 1)
    cell, n_cells = ij[:, 0] * shape[1] + ij[:, 1], shape[0] * shape[1]
    total = np.bincount(cell, weight, minlength=n_cells)
    order = np.lexsort((xyz[:, 2], cell))
    cum = np.cumsum(weight[order])
    before = np.concatenate([[0], cum])[np.searchsorted(cell[order], np.arange(n_cells))]
    pick = np.minimum(np.searchsorted(cum, before + SURFACE_PERCENTILE * total), len(cum) - 1)
    surface = np.where(total > 0, xyz[order, 2][pick], -np.inf)

    def window(grid, cells, fill, reduce):
        padded = np.pad(grid.reshape(shape), cells // 2, constant_values=fill)
        return reduce(np.lib.stride_tricks.sliding_window_view(padded, (cells, cells)), axis=(2, 3)).ravel()
    ceiling = window(surface, 3, -np.inf, np.max) + MAX_ABOVE_SURFACE_M
    floor = window(np.where(total > 0, surface, np.inf), 3, np.inf, np.min) - MAX_BELOW_SURFACE_M
    thin = MIN_DENSITY_RATIO * window(total, DENSITY_WINDOW_CELLS, 0.0, np.median)
    kept = total.copy()   # repeat until stable: removing a thin patch exposes the stragglers beside it
    while (drop := (kept > 0) & (window(kept, 3, 0.0, np.mean) < thin)).any():
        kept[drop] = 0
    return {f"at most {MAX_ABOVE_SURFACE_M} m above the splat's local surface": xyz[:, 2] <= ceiling[cell],
            f"at most {MAX_BELOW_SURFACE_M} m below the splat's local surface": xyz[:, 2] >= floor[cell],
            f"not in a patch under {MIN_DENSITY_RATIO} of the typical density nearby": kept[cell] > 0}


def cell_ids(xy, size):
    """Index of the size-metre square each point falls in, with the points per square."""
    ij = np.floor(xy / size).astype(np.int64)
    _, ids, counts = np.unique(ij[:, 0] * (1 << 32) + ij[:, 1], return_inverse=True, return_counts=True)
    return ids, counts


def ground_misfit(xy, above):
    """Splat ground against the DTM: median, over 1 m cells, of each cell's median height above terrain."""
    ids, counts = cell_ids(xy, GROUND_CELL_M)
    order = np.lexsort((above, ids))
    medians = above[order][np.cumsum(counts) - counts + counts // 2][counts >= 20]
    if not len(medians):
        raise SystemExit("too few Gaussians per 1 m cell to check the splat against the terrain")
    lo, mid, hi = np.percentile(medians, [16, 50, 84])
    return float(mid), float(hi - lo) / 2, len(medians)


def roughness(xy, above):
    """Std dev of Gaussian height above the DTM inside each 0.5 m cell."""
    # ponytail: detrended by the 1 m DTM, not a per-cell plane fit, so a slope the DTM misses reads as roughness.
    ids, counts = cell_ids(xy, ROUGHNESS_CELL_M)
    mean = np.bincount(ids, above) / counts
    return np.sqrt(np.maximum(np.bincount(ids, above ** 2) / counts - mean ** 2, 0))[ids]


def write_spz(path, g):
    """Write Niantic SPZ v3, quantised the same way as nianticlabs/spz, Gaussians in the order given."""
    n, k = g["rest"].shape[0], g["rest"].shape[2]
    pos = np.round(g["xyz"] * (1 << SPZ_FRAC_BITS)).astype("<i4")
    assert np.abs(pos).max() < 1 << 23, "position outside the 24-bit fixed-point range"
    quat = g["quat"][:, [1, 2, 3, 0]] / np.linalg.norm(g["quat"], axis=1, keepdims=True)   # x y z w
    big = np.abs(quat).argmax(1)                                    # drop the largest component, made positive
    quat = quat * np.where(np.take_along_axis(quat, big[:, None], 1) < 0, -1, 1)
    small = quat[np.arange(4) != big[:, None]].reshape(n, 3)
    code = (small < 0).astype(np.uint32) << 9 | np.minimum(511 * np.abs(small) * math.sqrt(2) + 0.5, 511).astype(np.uint32)
    rotation = (big.astype(np.uint32) << 30 | code[:, 0] << 20 | code[:, 1] << 10 | code[:, 2]).astype("<u4")
    sh = np.round(g["rest"].transpose(0, 2, 1) * 128) + 128         # [N, coefficient, rgb]
    bucket = np.where(np.arange(k) < 3, 8, 16)[None, :, None]       # 5 bits for degree 1, 4 above
    sh = (sh + bucket // 2) // bucket * bucket
    def u8(a):
        return np.clip(np.round(a), 0, 255).astype(np.uint8).tobytes()
    degree = round(math.sqrt(k + 1)) - 1
    body = (struct.pack("<IIIBBBB", SPZ_MAGIC, SPZ_VERSION, n, degree, SPZ_FRAC_BITS, int(ANTIALIASED), 0)
            + pos.view(np.uint8).reshape(n, 3, 4)[:, :, :3].tobytes()
            + u8(255 / (1 + np.exp(-g["opacity"].astype(np.float64)))) + u8((g["dc"] * 0.15 + 0.5) * 255)
            + u8((g["scale"] + 10) * 16) + rotation.tobytes() + u8(sh))
    path.write_bytes(gzip.compress(body, 6))
    return degree


def read_spz_xyz(path):
    """Positions back out of an SPZ file, to prove the order survived."""
    raw = gzip.decompress(path.read_bytes())
    magic, version, n, _, frac_bits, _, _ = struct.unpack("<IIIBBBB", raw[:16])
    assert (magic, version) == (SPZ_MAGIC, SPZ_VERSION)
    b = np.frombuffer(raw, np.uint8, n * 9, 16).reshape(n, 3, 3).astype(np.int32)
    v = b[..., 0] | b[..., 1] << 8 | b[..., 2] << 16
    return np.where(v & 0x800000, v - (1 << 24), v) / (1 << frac_bits)


def write_layers(bundle, layers):
    """layers.bin in the 24-byte record of contracts.md section 3; only the fields filled here are listed."""
    n = len(layers["elevation_m"])
    rec = np.zeros(n, np.dtype({"names": [*layers, "target_id", "visual_cluster"], "itemsize": 24,
                                "formats": ["<f2"] * 4 + ["<u2"] * 2, "offsets": [0, 2, 4, 6, 14, 18]}))
    for name, values in layers.items():
        rec[name] = values
    rec["target_id"] = rec["visual_cluster"] = 65535   # "none", until those layers are lifted
    rec.tofile(bundle / "layers.bin")
    dtm = {"source": "USGS Mars 2020 TRN HiRISE DTM", "resolution": "1 m/px"}
    fields = [
        {"name": "elevation_m", "type": "f16", "offset": 0, "unit": "m", **dtm,
         "datum": "site origin; add scene.json site_origin_map.z for metres above the MOLA geoid"},
        {"name": "slope_deg", "type": "f16", "offset": 2, "unit": "deg", **dtm},
        {"name": "roughness_m", "type": "f16", "offset": 4, "unit": "m", "resolution": f"{ROUGHNESS_CELL_M} m cell",
         "source": "splat geometry: std dev of Gaussian height above the DTM"},
        {"name": "height_above_ground_m", "type": "f16", "offset": 6, "unit": "m", "source": "splat vs DTM",
         "resolution": "per Gaussian"}]
    (bundle / "layers.json").write_text(json.dumps({"count": n, "record_bytes": 24, "fields": fields}, indent=2) + "\n")


def export(ply, bundle, frame_json=FRAME_JSON):
    frame, scene = json.loads(frame_json.read_text()), json.loads((bundle / "scene.json").read_text())
    g = load_ply(ply)
    raw, g["row"] = g["xyz"], np.arange(len(g["xyz"]), dtype=np.uint32)   # row follows every filter below
    xy_hero = g["xyz"][:, :2] - HERO_TRAIN_M
    tests = {"finite": np.isfinite(g["xyz"]).all(1) & np.isfinite(g["scale"]).all(1),
             f"opacity >= {MIN_OPACITY}": g["opacity"] >= math.log(MIN_OPACITY / (1 - MIN_OPACITY)),
             f"largest axis <= {MAX_SCALE_M} m": g["scale"].max(1) <= math.log(MAX_SCALE_M),
             f"within {CROP_RADIUS_M} m of the hero rock": np.hypot(xy_hero[:, 0], xy_hero[:, 1]) <= CROP_RADIUS_M}
    print(f"{ply}: {len(g['xyz'])} Gaussians\n" + "\n".join(f"  {k}: {ok.sum()} pass" for k, ok in tests.items()))
    g = {k: v[np.all(list(tests.values()), 0)] for k, v in g.items()}
    # Training origin in the site frame, from lon/lat on the DTM's sphere (not from NASA's waypoint eastings).
    origin, o = frame["origin"], scene["site_origin_map"]
    lat = o["y"] / R_MARS
    shift = np.array([R_MARS * math.cos(lat) * (math.radians(origin["lon_deg"]) - o["x"] / R_MARS),
                      R_MARS * (math.radians(origin["lat_deg"]) - lat), origin["elev_geoid_m"] - o["z"]])
    if not np.array_equal(R_TRAIN_TO_SITE, np.eye(3)):
        g = rotate(g, R_TRAIN_TO_SITE)
    g["xyz"] = g["xyz"] + shift
    ground = load_terrain(bundle, scene)
    z_ground, slope = ground(g["xyz"][:, 0], g["xyz"][:, 1])
    z_fix, spread, cells = ground_misfit(g["xyz"][:, :2], g["xyz"][:, 2] - z_ground)
    print(f"splat ground minus terrain, before: {z_fix:+.3f} m (cell-to-cell spread {spread:.3f} m, {cells} cells)")
    if abs(z_fix) > MAX_Z_FIX_M:
        raise SystemExit(f"vertical misfit above {MAX_Z_FIX_M} m: check the frames before exporting")
    g["xyz"][:, 2] -= z_fix
    above = g["xyz"][:, 2] - z_ground
    tests = {f"{-MAX_BELOW_GROUND_M} m <= height above terrain <= {MAX_ABOVE_GROUND_M} m":
             (above >= -MAX_BELOW_GROUND_M) & (above <= MAX_ABOVE_GROUND_M),
             **surface_tests(g["xyz"], 1 / (1 + np.exp(-g["opacity"].astype(np.float64))))}
    print("\n".join(f"  {k}: removes {(~ok).sum()} of {len(ok)}" for k, ok in tests.items()))
    keep = np.all(list(tests.values()), 0)
    g, z_ground, slope, above = {k: v[keep] for k, v in g.items()}, z_ground[keep], slope[keep], above[keep]
    after, spread, _ = ground_misfit(g["xyz"][:, :2], above)
    print(f"splat ground minus terrain, after:  {after:+.3f} m (cell-to-cell spread {spread:.3f} m)")

    degree = write_spz(bundle / "splat.spz", g)
    back = read_spz_xyz(bundle / "splat.spz")
    worst = float(np.abs(back - g["xyz"]).max()) if back.shape == g["xyz"].shape else math.inf
    print(f"splat.spz: {len(back)} Gaussians, SH degree {degree}, {(bundle / 'splat.spz').stat().st_size / 1e6:.1f} MB; "
          f"position i differs from input i by at most {worst * 1000:.3f} mm (step {1000 / (1 << SPZ_FRAC_BITS):.3f} mm)")
    write_layers(bundle, {"elevation_m": z_ground, "slope_deg": slope,
                          "roughness_m": roughness(g["xyz"][:, :2], above), "height_above_ground_m": above})
    moved = raw[g["row"]] @ R_TRAIN_TO_SITE.T + shift - [0, 0, z_fix]   # the PLY rows the index names, placed again
    assert np.abs(moved - back).max() <= 2 ** -SPZ_FRAC_BITS, "kept index does not reproduce the exported positions"
    np.save(ply.with_name(ply.stem + ".kept_index.npy"), g["row"])
    scene = json.loads((bundle / "scene.json").read_text())   # again: other steps write this file too
    scene["splat"] = {"file": "splat.spz", "count": len(back), "sh_degree": degree, "order_preserved": worst <= 2 ** -SPZ_FRAC_BITS,
                      "source_ply": str(ply), "frame_json": str(frame_json), "crop_radius_m": CROP_RADIUS_M,
                      "train_to_site_shift_m": (shift - [0, 0, z_fix]).round(4).tolist(), "z_fit_to_terrain_m": round(-z_fix, 4)}
    scene["layers"] = "layers.json"
    (bundle / "scene.json").write_text(json.dumps(scene, indent=2) + "\n")


def self_check():
    """Rotating a Gaussian rotates its covariance and its view-dependent colour with it; SPZ keeps order."""
    from scipy.spatial.transform import Rotation
    rng, n = np.random.default_rng(0), 500
    g = {"xyz": rng.normal(0, 5, (n, 3)), "dc": rng.normal(0, 1, (n, 3)).astype(np.float32),
         "rest": rng.normal(0, 0.3, (n, 3, 3)).astype(np.float32), "opacity": rng.normal(0, 2, n).astype(np.float32),
         "scale": rng.normal(-4, 1, (n, 3)).astype(np.float32), "quat": rng.normal(0, 1, (n, 4)).astype(np.float32)}
    R = Rotation.from_rotvec([0.3, -1.1, 0.7]).as_matrix()
    def cov(g):
        m = Rotation.from_quat(g["quat"][:, [1, 2, 3, 0]]).as_matrix() * np.exp(g["scale"])[:, None, :]
        return m @ m.transpose(0, 2, 1)
    def colour(g, d):   # the degree-1 term of the 3DGS colour, without its constant
        return np.einsum("nck,nk->nc", g["rest"], np.stack([-d[:, 1], d[:, 2], -d[:, 0]], 1))
    d, r = rng.normal(0, 1, (n, 3)), rotate(g, R)
    assert np.allclose(cov(r), R @ cov(g) @ R.T, atol=1e-7)
    assert np.allclose(colour(r, d @ R.T), colour(g, d), atol=1e-5)
    assert np.allclose(rotate(r, R.T)["xyz"], g["xyz"]) and np.allclose(cov(rotate(r, R.T)), cov(g), atol=1e-7)
    with tempfile.TemporaryDirectory() as tmp:
        write_spz(Path(tmp) / "t.spz", g)
        assert np.abs(read_spz_xyz(Path(tmp) / "t.spz") - g["xyz"]).max() <= 0.5 / (1 << SPZ_FRAC_BITS)
    print("self-check ok")


if __name__ == "__main__":
    if sys.argv[1:] != ["--self-check"] and len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    self_check() if len(sys.argv) == 2 else export(*map(Path, sys.argv[1:]))
