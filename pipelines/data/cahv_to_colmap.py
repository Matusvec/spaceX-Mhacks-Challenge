#!/usr/bin/env python3
"""Turn downloaded raw records (CAHVORE) into a COLMAP text model with known poses.

  python pipelines/data/cahv_to_colmap.py data/raw/cheyava_s56d0 data/colmap/cheyava_s56d0

Writes <out>/images/ (symlinks) and <out>/sparse/0/{cameras,images,points3D}.txt, ready for
feature matching + point_triangulator (docs/splat-pipeline.md steps 2-3, route A).
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation


def cahv_to_pinhole(C, A, H, V):
    """Linear part of CAHVORE -> K, world-to-camera R, t (OpenCV: +Z forward, +Y down).

    ponytail: O, R, E distortion terms ignored, so these poses are initialization only.
    Fine for Navcam/Mastcam-Z; add a fisheye model before feeding Hazcams.
    """
    A = A / np.linalg.norm(A)
    cx, cy = A @ H, A @ V
    fx, fy = np.linalg.norm(np.cross(A, H)), np.linalg.norm(np.cross(A, V))
    R = np.stack([(H - cx * A) / fx, (V - cy * A) / fy, A])
    err = np.abs(R @ R.T - np.eye(3)).max()
    U, _, Vt = np.linalg.svd(R)  # nearest orthonormal matrix
    R = U @ Vt
    return (fx, fy, cx, cy), R, -R @ C, err


def parse_model(rec):
    """'(x,y,z);(x,y,z);...' -> C, A, H, V arrays."""
    parts = rec["camera"]["camera_model_component_list"].split(";")[:4]
    return [np.array([float(v) for v in p.strip("()").split(",")]) for p in parts]


def usable(rec):
    """Skip narrowband and solar (ND) filter frames; they don't match the RGB frames."""
    f = rec["camera"]["filter_name"]
    return rec["camera"]["camera_model_type"].startswith("CAHV") and (f == "UNK" or f.endswith("_RGB"))


def main(raw, out):
    raw, out = Path(raw), Path(out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "sparse/0").mkdir(parents=True, exist_ok=True)
    recs = [json.loads(p.read_text()) for p in sorted(raw.glob("*.json"))]
    recs = [r for r in recs if usable(r) and (raw / f"{r['imageid']}.png").exists()]

    # ponytail: assumes one site/drive, so every model shares one rover frame. Mixing drives
    # needs each drive moved into a common frame first (rover attitude + PLACES), or route B.
    stops = {(r["site"], r["drive"]) for r in recs}
    if len(stops) > 1:
        print(f"WARNING: {len(stops)} site/drive stops mixed {sorted(stops)}; poses will not line up")

    cams, imgs, worst = [], [], 0.0
    for i, r in enumerate(recs, 1):
        (fx, fy, cx, cy), R, t, err = cahv_to_pinhole(*parse_model(r))
        worst = max(worst, err)
        # The feed's models are already in the pixel grid of the delivered tile (principal point
        # can sit far off-centre or outside the tile), so no scaleFactor/subframeRect fixup here.
        w, h = (int(v) for v in r["extended"]["dimension"].strip("()").split(","))
        name = f"{r['imageid']}.png"
        link = out / "images" / name
        if not link.exists():
            link.symlink_to((raw / name).resolve())
        qx, qy, qz, qw = Rotation.from_matrix(R).as_quat()
        cams.append(f"{i} PINHOLE {w} {h} {fx} {fy} {cx} {cy}")
        imgs.append(f"{i} {qw} {qx} {qy} {qz} {t[0]} {t[1]} {t[2]} {i} {name}\n")  # blank line = no 2D points

    sparse = out / "sparse/0"
    (sparse / "cameras.txt").write_text("\n".join(cams) + "\n")
    (sparse / "images.txt").write_text("\n".join(imgs) + "\n")
    (sparse / "points3D.txt").write_text("")
    print(f"{len(recs)} images -> {out}   worst orthonormality error {worst:.2e} (want < 1e-3)")


if __name__ == "__main__":
    # self-check: a camera at C looking down +X with f=1000, centre (640, 480) round-trips
    _k, _R, _t, _e = cahv_to_pinhole(np.array([1., 2, 3]), np.array([1., 0, 0]),
                                     np.array([640., 1000, 0]), np.array([480., 0, 1000]))
    assert np.allclose(_k, (1000, 1000, 640, 480)) and _e < 1e-9 and np.allclose(_R @ [1, 2, 3] + _t, 0)
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
