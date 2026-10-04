#!/usr/bin/env python3
"""Tint the grey orbital orthophoto to the colour the rover saw, so the splat does not sit on a grey sheet.

  python3 pipelines/data/tint_terrain.py runs/cheyava-site-v3/ply/point_cloud_29999.ply scenes/mars-hero-01

HiRISE's orthomosaic is one band: it has brightness but no colour. The splat around the
rover is in colour. This multiplies the orthophoto by the splat's median colour and scales
it so the ground under the splat has the splat's brightness. It is a presentation choice,
not a measurement, and scene.json says so. The untouched image is kept as
terrain_texture_gray.jpg and the tint is always computed from that, so reruns do not compound.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from export_scene import CROP_RADIUS_M, HERO_TRAIN_M, MIN_OPACITY, load_ply

SH_C0 = 0.28209479177387814
NOTE = ("Grey HiRISE orthophoto (one band, no colour) multiplied by the median colour of the rover-image splat "
        "and scaled to its brightness. A presentation tint, not measured surface colour.")


def tint(gray, rgb, reference):
    """gray [H, W] 0..255 -> RGB in which a grey level of `reference` becomes the colour `rgb`."""
    return np.clip(gray[..., None].astype(np.float32) / max(reference, 1e-6) * rgb, 0, 255).astype(np.uint8)


def main(ply, bundle):
    bundle = Path(bundle)
    scene = json.loads((bundle / "scene.json").read_text())
    name = scene["terrain"]["texture"]
    gray_path = bundle / "terrain_texture_gray.jpg"
    if not gray_path.exists():
        (bundle / name).rename(gray_path)
    gray = np.asarray(Image.open(gray_path).convert("L"))

    g = load_ply(ply)
    near = np.hypot(*(g["xyz"][:, :2] - HERO_TRAIN_M).T) <= CROP_RADIUS_M
    solid = g["opacity"] >= np.log(MIN_OPACITY / (1 - MIN_OPACITY))
    rgb = np.median(np.clip(0.5 + SH_C0 * g["dc"][near & solid], 0, 1), 0) * 255

    # the site origin is at the centre of the texture; match brightness on the ground the splat covers
    h, w = gray.shape
    r = int(CROP_RADIUS_M / scene["terrain"]["size_m"][1] * h)
    patch = gray[h // 2 - r:h // 2 + r, w // 2 - r:w // 2 + r]
    Image.fromarray(tint(gray, rgb, patch.mean())).save(bundle / name, quality=90)

    scene["terrain"]["texture_tint"] = {"rgb": [int(v) for v in rgb.round()], "note": NOTE, "untinted": gray_path.name}
    (bundle / "scene.json").write_text(json.dumps(scene, indent=2) + "\n")
    print(f"splat median colour {rgb.round().astype(int).tolist()}, orthophoto patch mean {patch.mean():.0f} -> {bundle / name}")


if __name__ == "__main__":
    _t = tint(np.array([[50, 100]], np.uint8), np.array([200.0, 100.0, 50.0]), 100)
    assert _t.tolist() == [[[100, 50, 25], [200, 100, 50]]]
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
