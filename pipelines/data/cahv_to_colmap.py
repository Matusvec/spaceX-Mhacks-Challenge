#!/usr/bin/env python3
"""Turn downloaded raw records (CAHVORE) into a COLMAP text model with known poses.

  python pipelines/data/cahv_to_colmap.py data/raw/cheyava_s56d0 data/colmap/cheyava_s56d0

Writes the frames a Gaussian splat can actually use: debayered color, zoomed on
the ground in front of the rover, one image per aim. Symlinks plus
<out>/sparse/0/{cameras,images,points3D}.txt, ready for feature matching +
point_triangulator (docs/splat-pipeline.md steps 2-3, route A).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
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


def product_kind(imageid):
    for k in ("EBY", "ECM", "ECZ", "ECV", "ECR", "ECS"):
        if k in imageid:
            return k
    return ""


def color_frame(rec):
    """Browse PNG that is actually color, and broadband.

    Analyst's Notebook: EBY is de-Bayered, ECM is the original product.
    Mastcam-Z ECM browse PNGs are grayscale (R=G=B); DOM reconstructions use EBY.
    Navcam ECM browse PNGs are already color. Narrowband and ND filters do not
    match the RGB frames, so they stay out.
    """
    f = rec["camera"]["filter_name"]
    if "ND" in f or not rec["camera"]["camera_model_type"].startswith("CAHV"):
        return False
    kind = product_kind(rec["imageid"])
    inst = rec["camera"]["instrument"]
    if inst.startswith("MCZ"):
        return kind == "EBY" and f.endswith("_RGB")
    if inst.startswith("NAVCAM"):
        return kind == "ECM" and f == "UNK"
    return False


def ground_hit(C, A):
    """Boresight intersection with the ground plane z=0. Rover frame, +Z down."""
    A = A / np.linalg.norm(A)
    if A[2] <= 0.05:
        return None
    t = -float(C[2]) / float(A[2])
    if t <= 0:
        return None
    return float(C[0] + t * A[0]), float(C[1] + t * A[1]), t


def for_splat(rec):
    """Zoomed color view of the ground in front of the rover.

    This stop never drove, so the only parallax is the Mastcam-Z stereo baseline
    plus a few centimetres of mast motion. Keep both eyes of the ~110 mm
    workspace raster. Drop horizon frames, the backward look, and Navcam:
    those tiles are one pose chopped up, the public PNGs are stretched per tile,
    and the down-looking ones are full of the rover arm.
    """
    if not rec["camera"]["instrument"].startswith("MCZ") or not color_frame(rec):
        return False
    C, A, H, V = parse_model(rec)
    fx = float(np.linalg.norm(np.cross(A / np.linalg.norm(A), H)))
    if fx < 10000 or float(rec["extended"]["mastEl"]) > -28:
        return False
    hit = ground_hit(C, A)
    return hit is not None and hit[0] > 0.8 and hit[2] < 5.5


def sharpness(path):
    im = np.asarray(Image.open(path).convert("L"), dtype=np.float32)[::4, ::4]
    lap = im[:-2, 1:-1] + im[2:, 1:-1] + im[1:-1, :-2] + im[1:-1, 2:] - 4 * im[1:-1, 1:-1]
    return float(lap.var())


def dedup(recs, raw):
    """Same aim across sols and focus pairs: keep the sharpest frame."""
    groups = {}
    for r in recs:
        C, A, H, V = parse_model(r)
        fx = float(np.linalg.norm(np.cross(A / np.linalg.norm(A), H)))
        az, el = float(r["extended"]["mastAz"]), float(r["extended"]["mastEl"])
        key = (r["camera"]["instrument"], round(az * 2) / 2, round(el * 2) / 2, round(fx / 500))
        groups.setdefault(key, []).append(r)
    kept = []
    for group in groups.values():
        if len(group) == 1:
            kept.append(group[0])
        else:
            kept.append(max(group, key=lambda r: sharpness(raw / f"{r['imageid']}.png")))
    return kept


def main(raw, out):
    raw, out = Path(raw), Path(out)
    img_dir = out / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    (out / "sparse/0").mkdir(parents=True, exist_ok=True)
    all_recs = [json.loads(p.read_text()) for p in sorted(raw.glob("*.json"))]
    present = [r for r in all_recs if (raw / f"{r['imageid']}.png").exists()]
    aimed = [r for r in present if for_splat(r)]
    recs = dedup(aimed, raw)

    # ponytail: assumes one site/drive, so every model shares one rover frame. Mixing drives
    # needs each drive moved into a common frame first (rover attitude + PLACES), or route B.
    stops = {(r["site"], r["drive"]) for r in recs}
    if len(stops) > 1:
        print(f"WARNING: {len(stops)} site/drive stops mixed {sorted(stops)}; poses will not line up")
    print(f"kept {len(recs)} of {len(present)}  (zoomed color views of the ground ahead, duplicates dropped)")

    for stale in img_dir.iterdir():
        if stale.name not in {f"{r['imageid']}.png" for r in recs}:
            stale.unlink()

    cams, imgs, worst = [], [], 0.0
    for i, r in enumerate(sorted(recs, key=lambda r: r["imageid"]), 1):
        (fx, fy, cx, cy), R, t, err = cahv_to_pinhole(*parse_model(r))
        worst = max(worst, err)
        # The feed's models are already in the pixel grid of the delivered tile (principal point
        # can sit far off-centre or outside the tile), so no scaleFactor/subframeRect fixup here.
        w, h = (int(v) for v in r["extended"]["dimension"].strip("()").split(","))
        name = f"{r['imageid']}.png"
        link = img_dir / name
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
