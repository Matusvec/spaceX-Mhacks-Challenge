#!/usr/bin/env python3
"""Check a terrain-class lift from the rover's own viewpoint: each photo beside the Gaussians that camera
sees, drawn as dots in the colour of their lifted class (the fused, multi-image result, not that image's map).

  .venv-semantic/bin/python pipelines/semantic/render_view.py <splat.ply> <lift.npz> <out.jpg> <image name> [...]
      [--scene data/colmap/cheyava_site_v2]
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
from check_scene import load as load_colmap  # noqa: E402
from export_scene import load_ply  # noqa: E402
from lift_terrain import OCCLUDER_OPACITY, observe  # noqa: E402
from predict_terrain import COLOURS_BGR  # noqa: E402

PANEL_WIDTH = 900


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ply"), ap.add_argument("npz"), ap.add_argument("out"), ap.add_argument("names", nargs="+")
    ap.add_argument("--scene", default="data/colmap/cheyava_site_v2")
    args = ap.parse_args()
    g, probs = load_ply(args.ply), np.load(args.npz)["probs"]
    assert len(probs) == len(g["xyz"]), "the lift belongs to a different PLY"
    occluder = g["opacity"] >= np.log(OCCLUDER_OPACITY / (1 - OCCLUDER_OPACITY))
    radius = np.exp(g["scale"].max(1))
    images = {im["name"]: im for im in load_colmap(args.scene)[0]}
    rows = []
    for name in args.names:
        im = images[name]
        w, h = im["cam"][:2]
        idx, uv, depth = observe(im, g["xyz"], radius, occluder)
        keep = probs[idx].any(1)
        order = np.flatnonzero(keep)[np.argsort(-depth[keep])]      # far first, near dots on top
        idx, uv = idx[order], uv[order]
        photo = cv2.imread(str(Path(args.scene) / "images" / name))
        canvas = (cv2.cvtColor(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR) * 0.6).astype(np.uint8)
        dot = max(2, round(w / PANEL_WIDTH * 1.5))
        for (u, v), c in zip(uv.astype(int), COLOURS_BGR[probs[idx].argmax(1)].tolist()):
            cv2.circle(canvas, (u, v), dot, c, -1)
        both = np.hstack([photo, canvas])
        both = cv2.resize(both, (2 * PANEL_WIDTH, round(h * PANEL_WIDTH / w)), interpolation=cv2.INTER_AREA)
        cv2.putText(both, name, (8, both.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)
        rows.append(both)
        print(f"{name}: {len(idx)} labelled Gaussians in view")
    cv2.imwrite(args.out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])


if __name__ == "__main__":
    main()
