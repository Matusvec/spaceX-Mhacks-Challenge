#!/usr/bin/env python3
"""Check a terrain-class lift by eye: the splat from above in its own colours, beside its most likely class.

  .venv-semantic/bin/python pipelines/semantic/render_topdown.py <splat.ply> <lift.npz> <out.png> [--size 30] [--res 0.03]

North is up, east is right, in the splat's training frame. Each Gaussian is one dot (not a rendered splat),
the highest one wins a pixel. Grey in the right panel means "unknown": no image saw that Gaussian.
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
from export_scene import load_ply  # noqa: E402
from predict_terrain import COLOURS_BGR  # noqa: E402

CLASSES = ["soil", "bedrock", "sand", "big_rock"]
HERO = (0.69, 1.88)     # Cheyava Falls, east and north in the training frame
MIN_OPACITY = 0.3
UNKNOWN_BGR = (70, 70, 70)
SH_C0 = 0.28209479177387814


def window(g, size, max_height=3.0):
    """Indices of the opaque Gaussians in the square window around the hero rock, lowest first."""
    xy = g["xyz"][:, :2] - HERO
    keep = (np.abs(xy) < size / 2).all(1) & (g["opacity"] >= np.log(MIN_OPACITY / (1 - MIN_OPACITY)))
    keep &= g["xyz"][:, 2] < np.median(g["xyz"][keep, 2]) + max_height
    return np.flatnonzero(keep)[np.argsort(g["xyz"][keep, 2])]          # low first, so the top surface is drawn last


def panel(xyz, colours_bgr, size, res, title):
    """One top-down picture: a 2x2 dot per Gaussian in the order given, hero rock circled, scale bar."""
    n = int(round(size / res))
    col = np.clip(((xyz[:, 0] - HERO[0] + size / 2) / res).astype(int), 0, n - 2)
    row = np.clip(((size / 2 - xyz[:, 1] + HERO[1]) / res).astype(int), 0, n - 2)
    img = np.zeros((n, n, 3), np.uint8)
    for dr, dc in ((0, 0), (0, 1), (1, 0), (1, 1)):   # 2x2 dots close the gaps between centres
        img[row + dr, col + dc] = colours_bgr
    cv2.circle(img, (n // 2, n // 2), max(int(0.5 / res), 4), (255, 255, 255), 1, cv2.LINE_AA)   # hero rock, 0.5 m radius
    metres = 5 if size >= 20 else 1
    cv2.line(img, (20, n - 20), (20 + int(round(metres / res)), n - 20), (255, 255, 255), 2)
    cv2.putText(img, f"{metres} m   {title}   N up", (20, n - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return img


def splat_colours(g, order):
    return np.clip((0.5 + SH_C0 * g["dc"][order]) * 255, 0, 255).astype(np.uint8)[:, ::-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ply"), ap.add_argument("npz"), ap.add_argument("out")
    ap.add_argument("--size", type=float, default=30.0, help="side of the square window, metres")
    ap.add_argument("--res", type=float, default=0.03, help="metres per pixel")
    ap.add_argument("--max-height", type=float, default=3.0, help="drop Gaussians this far above the window's median height")
    args = ap.parse_args()
    g, lift = load_ply(args.ply), np.load(args.npz)
    probs = lift["probs"]
    assert len(probs) == len(g["xyz"]), "the lift belongs to a different PLY"
    order = window(g, args.size, args.max_height)
    known = probs[order].any(1)
    cls = np.where(known[:, None], COLOURS_BGR[probs[order].argmax(1)], UNKNOWN_BGR).astype(np.uint8)
    panels = [panel(g["xyz"][order], splat_colours(g, order), args.size, args.res, "splat colour"),
              panel(g["xyz"][order], cls, args.size, args.res, "terrain class (argmax)")]
    for i, name in enumerate(CLASSES + ["unknown"]):
        colour = COLOURS_BGR[i].tolist() if i < 4 else UNKNOWN_BGR
        cv2.rectangle(panels[1], (20 + 130 * i, 14), (38 + 130 * i, 32), colour, -1)
        cv2.putText(panels[1], name, (44 + 130 * i, 29), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.imwrite(args.out, np.hstack(panels))
    seen = known.mean() if len(known) else 0
    frac = np.bincount(probs[order][known].argmax(1), minlength=4) / max(known.sum(), 1)
    print(f"{args.out}: {len(order)} Gaussians in a {args.size:g} m window, {seen:.1%} labelled; "
          + ", ".join(f"{c} {f:.1%}" for c, f in zip(CLASSES, frac)))


if __name__ == "__main__":
    main()
