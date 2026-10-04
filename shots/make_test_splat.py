#!/usr/bin/env python3
"""Test bundles for the viewer: the stereo point cloud as a splat in the site frame, on the real terrain.

  python3 shots/make_test_splat.py      (from the worktree root)

Writes scenes/mars-hero-01-test (3DGS PLY), -test-spz (the exporter's own SPZ writer) and -test-stretched
(same PLY, terrain size_m 2000 x 2000 as before the east-west fix). Never touches the real bundle.
"""
import json
import math
import os
import sys
from pathlib import Path

import numpy as np

REPO = Path("/mnt/data/projects/hackathons/spaceX-Mhacks-Challenge")
BUNDLE = REPO / "scenes/mars-hero-01"
COLMAP = REPO / "data/colmap/cheyava_site"
OUT = Path(__file__).resolve().parent.parent / "scenes"
sys.path.insert(0, str(REPO / "pipelines/data"))
import export_scene as ex  # noqa: E402  (the exporter's terrain sampler and SPZ writer)

SH_C0 = 0.28209479177387814
PLY_PROPS = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", *[f"f_rest_{i}" for i in range(9)],
             "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]


def post(x, y, z0, height, rgb):
    """A column of Gaussians, as an orientation marker."""
    z = np.arange(0, height, 0.05)
    return np.column_stack([np.full_like(z, x), np.full_like(z, y), z0 + z]), np.tile(rgb, (len(z), 1))


def main():
    scene = json.loads((BUNDLE / "scene.json").read_text())
    frame = json.loads((COLMAP / "frame.json").read_text())
    pts = np.loadtxt(COLMAP / "sparse/0/points3D.txt", usecols=range(1, 7))
    xyz, rgb = pts[:, :3], pts[:, 3:] / 255

    # Training frame to site frame, the same way pipelines/data/export_scene.py does it.
    origin, o = frame["origin"], scene["site_origin_map"]
    lat = o["y"] / ex.R_MARS
    shift = np.array([ex.R_MARS * math.cos(lat) * (math.radians(origin["lon_deg"]) - o["x"] / ex.R_MARS),
                      ex.R_MARS * (math.radians(origin["lat_deg"]) - lat), origin["elev_geoid_m"] - o["z"]])
    rover = -np.array(frame["stops"]["cheyava_s56d0"]["rover_position"])
    print(f"shift from lon/lat (exporter): {shift.round(3)}   minus s56d0 rover position (frame.json): {rover.round(3)}")
    xyz = xyz + shift

    ground, cos_lat = ex.load_terrain(BUNDLE, scene)
    near = np.hypot(xyz[:, 0], xyz[:, 1]) < 20
    z_fix, spread, cells = ex.ground_misfit(xyz[near, :2], xyz[near, 2] - ground(xyz[near, 0], xyz[near, 1])[0])
    print(f"points minus terrain within 20 m: {z_fix:+.3f} m (spread {spread:.3f} m, {cells} cells); removed")
    xyz[:, 2] -= z_fix

    t = scene["terrain"]

    # Gaussian size grows with range from the nearer rover stop, like stereo point spacing does.
    dist = np.minimum(np.linalg.norm(xyz, axis=1), np.linalg.norm(xyz - shift + [0, 0, z_fix], axis=1))
    sigma = np.clip(0.006 * dist, 0.008, 0.3)

    # Markers: red post 10 m east, blue post 10 m north, green post at the origin, each 2 m tall on the ground.
    for (x, y), colour in (((10, 0), (1, 0, 0)), ((0, 10), (0, 0.2, 1)), ((0, 0), (0, 1, 0))):
        p, c = post(x, y, float(ground(np.array([x]), np.array([y]))[0][0]), 2.0, colour)
        xyz, rgb, sigma = np.vstack([xyz, p]), np.vstack([rgb, c]), np.concatenate([sigma, np.full(len(p), 0.04)])

    n = len(xyz)
    quat = np.tile(np.float32([1, 0, 0, 0]), (n, 1))                     # w x y z
    scale, rest, r = np.repeat(sigma[:, None], 3, 1), np.zeros((n, 3, 3), np.float32), math.sqrt(0.5)

    def z_at(x, y):
        return float(ground(np.array([x]), np.array([y]))[0][0])
    # Format probes, 1.5 m above the ground. Needles are 2 m long on their local x axis:
    #   magenta at (5, 5) turned to lie north-south, cyan at (-5, 5) turned to stand upright.
    # Balls with a degree-1 SH term: at (-3, -6) red seen from the north, cyan from the south;
    #   at (3, -6) green seen from the east, magenta from the west. Both grey from straight above.
    probes = [((5, 5), (1, 0, 1), (1.0, 0.04, 0.04), (r, 0, 0, r), None),
              ((-5, 5), (0, 1, 1), (1.0, 0.04, 0.04), (r, 0, -r, 0), None),
              ((-3, -6), (.5, .5, .5), (0.3, 0.3, 0.3), (1, 0, 0, 0), (0, 0)),   # red channel, -y coefficient
              ((3, -6), (.5, .5, .5), (0.3, 0.3, 0.3), (1, 0, 0, 0), (1, 2))]    # green channel, -x coefficient
    for (x, y), colour, sig, q, sh in probes:
        xyz, rgb = np.vstack([xyz, [x, y, z_at(x, y) + 1.5]]), np.vstack([rgb, colour])
        scale, quat = np.vstack([scale, sig]), np.vstack([quat, np.float32(q)])
        rest = np.concatenate([rest, np.zeros((1, 3, 3), np.float32)])
        if sh:
            rest[-1, sh[0], sh[1]] = 0.9

    n = len(xyz)
    g = {"xyz": xyz, "dc": ((rgb - 0.5) / SH_C0).astype(np.float32), "rest": rest,
         "opacity": np.full(n, math.log(0.95 / 0.05), np.float32), "scale": np.log(scale).astype(np.float32),
         "quat": quat}
    # 3DGS PLY order: f_rest is channel-major (all red coefficients, then green, then blue).
    ply = np.column_stack([xyz, np.zeros((n, 3)), g["dc"], rest.reshape(n, 9), g["opacity"], g["scale"], quat]).astype("<f4")
    header = "ply\nformat binary_little_endian 1.0\n" + f"element vertex {n}\n" + \
        "".join(f"property float {p}\n" for p in PLY_PROPS) + "end_header\n"

    # -stretched keeps the terrain at its size in map units (2000 m), as the bundle had it before the fix.
    variants = {"mars-hero-01-test": ("splat.ply", t["size_m"]),
                "mars-hero-01-test-spz": ("splat.spz", t["size_m"]),
                "mars-hero-01-test-stretched": ("splat.ply", [2000.0, 2000.0])}
    for name, (splat_file, size_m) in variants.items():
        folder = OUT / name
        folder.mkdir(parents=True, exist_ok=True)
        for file in (t["file"], t["texture"], scene["pins"]):
            if not (folder / file).exists():
                os.symlink(BUNDLE / file, folder / file)
        if splat_file.endswith(".spz"):
            ex.write_spz(folder / splat_file, g)
        else:
            (folder / splat_file).write_bytes(header.encode("ascii") + ply.tobytes())
        manifest = {**scene, "scene_id": name, "terrain": {**t, "size_m": size_m},
                    "splat": {"file": splat_file, "count": n, "sh_degree": 1, "order_preserved": True}}
        manifest.pop("layers", None)
        (folder / "scene.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"wrote {folder}: {n} Gaussians, terrain size_m {size_m}")


main()
