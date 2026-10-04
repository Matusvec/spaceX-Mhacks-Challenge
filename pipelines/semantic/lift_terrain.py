#!/usr/bin/env python3
"""Lift per-image terrain-class probabilities onto the Gaussians of a trained splat.

  .venv-semantic/bin/python pipelines/semantic/lift_terrain.py <splat.ply> <out.npz> \
      [--scene data/colmap/cheyava_site_v2] [--cams nav] [--self-check]

METHOD (simpler than the rasterizer-gradient method in docs/semantic-layers.md, and said so in the output):
each Gaussian CENTRE is projected into every image with the known pose. An observation counts when the centre
is inside the image, within MAX_RANGE_M of the camera (AI4Mars labels stop at 30 m, so the model never learnt
anything farther), and not hidden: its depth must be within DEPTH_TOL of the nearest opaque Gaussian whose
footprint (a square the size of its longest 1-sigma axis, on a grid of CELL_PX cells) covers that pixel. The class probabilities at that pixel are averaged over images,
weighted by 1 / depth^2 (the Gaussian's footprint in the image, the stand-in for its blending weight).
A Gaussian's own opacity and extent are not used beyond the occlusion test. Gaussians seen by no image keep
all-zero probabilities, which means "unknown".

The PLY must be in the same world frame as the scene's poses (the gsplat training frame).
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
from check_scene import load as load_colmap  # noqa: E402
from export_scene import load_ply  # noqa: E402

CLASSES = ["soil", "bedrock", "sand", "big_rock"]
MAX_RANGE_M = 30.0
CELL_PX = 4            # z-buffer cell, in image pixels
DEPTH_TOL = 0.08       # visible if depth <= (1 + DEPTH_TOL) * nearest depth around it
OCCLUDER_OPACITY = 0.3  # only Gaussians at least this opaque can hide others
BORDER_PX = 2
EDGE_MARGIN_PX = 64     # the model's labels along image edges are unreliable (seen: a "sand" strip on bottom edges),
                        # so pixels this close to an edge are not used; they still occlude
MAX_REACH_CELLS = 4    # largest half-width of an occluder's stamp, in cells
MAX_OCCLUDER_RADIUS_M = 0.1   # a flat Gaussian of radius s seen from height h spans s / h of its depth: keep that under DEPTH_TOL


def visible(uv, depth, radius_px, occluder, width, height):
    """Which projected centres are in the image, in range and not behind a nearer opaque Gaussian.

    Each occluder stamps its centre depth on a square of z-buffer cells the size of its footprint, because
    centres alone are far sparser than pixels near the camera and would let hidden Gaussians through.
    """
    with np.errstate(invalid="ignore"):
        inside = ((depth > 0.05) & (depth <= MAX_RANGE_M) & (uv[:, 0] >= BORDER_PX) & (uv[:, 0] < width - BORDER_PX)
                  & (uv[:, 1] >= BORDER_PX) & (uv[:, 1] < height - BORDER_PX))
    idx = np.flatnonzero(inside)
    gw, gh = width // CELL_PX + 1, height // CELL_PX + 1
    cx, cy = (uv[idx, 0] // CELL_PX).astype(np.int64), (uv[idx, 1] // CELL_PX).astype(np.int64)
    zbuf = np.full(gw * gh, np.inf, np.float32)
    reach = np.clip(np.ceil(radius_px[idx] / CELL_PX), 1, MAX_REACH_CELLS).astype(int)
    for r in range(1, MAX_REACH_CELLS + 1):
        m = occluder[idx] & (reach == r)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                np.minimum.at(zbuf, np.clip(cy[m] + dy, 0, gh - 1) * gw + np.clip(cx[m] + dx, 0, gw - 1), depth[idx][m].astype(np.float32))
    return idx[depth[idx] / (1 + DEPTH_TOL) <= zbuf[cy * gw + cx]]


def observe(im, xyz, radius_m, occluder, margin_px=0):
    """One posed image -> (indices of the Gaussians it sees, their pixel positions [n, 2], their depths [n])."""
    w, h, fx, fy, cx, cy = im["cam"]
    pc = xyz @ im["R"].T + im["t"]
    depth = pc[:, 2]
    with np.errstate(invalid="ignore", divide="ignore"):
        uv = np.stack([fx * pc[:, 0] / depth + cx, fy * pc[:, 1] / depth + cy], 1)
        radius_px = fx * np.minimum(radius_m, MAX_OCCLUDER_RADIUS_M) / depth
    idx = visible(uv, depth, radius_px, occluder, w, h)
    m = min(margin_px, w // 8, h // 8)
    idx = idx[(uv[idx, 0] >= m) & (uv[idx, 0] < w - m) & (uv[idx, 1] >= m) & (uv[idx, 1] < h - m)]
    return idx, uv[idx], depth[idx]


def lift(xyz, opacity, radius_m, images, prob_dir):
    """-> probs float32 [N, 4] (rows sum to 1, or 0 if unseen), weight [N], views [N]."""
    acc, weight = np.zeros((len(xyz), 4), np.float64), np.zeros(len(xyz), np.float64)
    views = np.zeros(len(xyz), np.uint16)
    occluder = opacity >= OCCLUDER_OPACITY
    for im in images:
        w, h = im["cam"][:2]
        idx, uv, depth = observe(im, xyz, radius_m, occluder, EDGE_MARGIN_PX)
        p = cv2.imread(str(prob_dir / (Path(im["name"]).stem + ".png")), cv2.IMREAD_UNCHANGED)
        assert p is not None and p.ndim == 3 and p.shape[2] == 4, f"no 4-channel probability map for {im['name']}"
        px = np.minimum((uv[:, 0] * p.shape[1] / w).astype(int), p.shape[1] - 1)
        py = np.minimum((uv[:, 1] * p.shape[0] / h).astype(int), p.shape[0] - 1)
        wt = 1.0 / np.maximum(depth, 1.0) ** 2
        acc[idx] += p[py, px] / 255.0 * wt[:, None]
        weight[idx] += wt
        views[idx] += 1
    seen = weight > 0
    probs = np.zeros((len(xyz), 4), np.float32)
    probs[seen] = acc[seen] / acc[seen].sum(1, keepdims=True)
    return probs, weight.astype(np.float32), views


def self_check():
    """A wall hides the ground behind it; ground in front of it, and beside it, stays visible."""
    f, w, h = 1500.0, 800, 600                                                    # a Navcam-like camera 2 m up
    gx, gz = np.meshgrid(np.linspace(-8, 8, 640), np.linspace(10, 28, 400))
    ground = np.stack([gx.ravel(), np.full(gx.size, 2.0), gz.ravel()], 1)          # camera frame: +y is down
    wx, wy = np.meshgrid(np.linspace(-1, 1, 200), np.linspace(-1, 2, 300))
    wall = np.stack([wx.ravel(), wy.ravel(), np.full(wx.size, 15.0)], 1)           # 2 m wide, 3 m tall, 15 m away
    pts = np.concatenate([ground, wall])
    uv = np.stack([f * pts[:, 0] / pts[:, 2] + w / 2, f * pts[:, 1] / pts[:, 2] + h / 2], 1)
    vis = np.zeros(len(pts), bool)
    vis[visible(uv, pts[:, 2], f * 0.03 / pts[:, 2], np.ones(len(pts), bool), w, h)] = True
    g, slope, in_view = vis[: len(ground)], np.abs(ground[:, 0] / ground[:, 2]), np.abs(ground[:, 0] / ground[:, 2]) < 0.26
    behind = (slope < 0.05) & (ground[:, 2] > 17)      # rays to these points pass through the wall
    front = in_view & (ground[:, 2] > 10.2) & (ground[:, 2] < 14.5)
    beside = in_view & (slope > 0.1) & (ground[:, 2] > 17)
    assert not g[behind].any(), "ground behind the wall leaked through"
    assert g[front].mean() > 0.98 and g[beside].mean() > 0.98, (g[front].mean(), g[beside].mean())
    assert vis[len(ground):].mean() > 0.98, "the wall itself should be visible"
    print("self-check ok")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ply", nargs="?"), ap.add_argument("out", nargs="?")
    ap.add_argument("--scene", default="data/colmap/cheyava_site_v2")
    ap.add_argument("--pred", help="default: runs/ai4mars/pred/<scene name>")
    ap.add_argument("--cams", default="nav", help="comma-separated camera tags an image name must contain; 'all' for every image")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        return self_check()
    if not (args.ply and args.out):
        ap.error("need <splat.ply> <out.npz>")
    scene = Path(args.scene)
    pred = Path(args.pred) if args.pred else Path("runs/ai4mars/pred") / scene.name
    images, _ = load_colmap(scene)
    tags = None if args.cams == "all" else args.cams.split(",")
    used = [im for im in images if tags is None or any(f"_{t}" in im["name"] for t in tags)]
    g = load_ply(args.ply)
    opacity = 1 / (1 + np.exp(-g["opacity"].astype(np.float64)))
    probs, weight, views = lift(g["xyz"], opacity, np.exp(g["scale"].max(1)), used, pred / "probs")
    seen = views > 0
    top = np.bincount(probs[seen].argmax(1), minlength=4)
    meta = {
        "ply": str(args.ply), "count": len(probs), "scene": str(scene), "labels": CLASSES,
        "images_used": len(used), "images_in_scene": len(images), "cams": args.cams,
        "method": ("projection of Gaussian centres into posed rover images; occlusion by a z-buffer of opaque Gaussians "
                   f"stamped as squares of their 1-sigma size ({CELL_PX} px cells, {DEPTH_TOL:.0%} depth tolerance); observations within {MAX_RANGE_M:g} m and at least "
                   f"{EDGE_MARGIN_PX} px from an image edge; "
                   "average over images weighted by 1/depth^2. Not the rasterizer blending-weight lift of docs/semantic-layers.md."),
        "labelled_fraction": round(float(seen.mean()), 4),
        "argmax_fraction_of_labelled": {c: round(float(n / max(seen.sum(), 1)), 4) for c, n in zip(CLASSES, top)},
        "unknown": "probs row is all zeros (seen by no image)",
    }
    np.savez_compressed(args.out, probs=np.round(probs * 255).astype(np.uint8), weight=weight, views=views, meta=json.dumps(meta))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
