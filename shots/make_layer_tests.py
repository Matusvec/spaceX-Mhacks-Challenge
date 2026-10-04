#!/usr/bin/env python3
"""Test scenes for the viewer's "Splat layers" control. Writes only under this worktree's scenes/.

  mars-hero-01-classtest  the real splat plus a SYNTHETIC terrain_class field (u8x4), to exercise the class legend:
                          four quadrants around the rock, and no class (all zero) within 2 m of it
  mars-hero-01-ordertest  the real bundle with splat.order_preserved set to false
  mars-hero-01-counttest  a splat cropped to 9 m with the full-size layers: record count does not match
  mars-hero-01-graytex    the real bundle with the untinted grey orthophoto, to tell terrain from splat
"""
import gzip
import json
import os
import struct
from pathlib import Path

import numpy as np

B = Path("/mnt/data/projects/hackathons/spaceX-Mhacks-Challenge/scenes/mars-hero-01")
OUT = Path(__file__).resolve().parent.parent / "scenes"
HERO = (-2.55, -0.59)
scene = json.loads((B / "scene.json").read_text())
schema = json.loads((B / "layers.json").read_text())


def scene_dir(name, manifest, links):
    d = OUT / name
    d.mkdir(exist_ok=True)
    for f in links:
        if (d / f).is_symlink() or (d / f).exists():
            (d / f).unlink()
        os.symlink(B / f, d / f)
    (d / "scene.json").write_text(json.dumps({**manifest, "scene_id": name}, indent=2) + "\n")
    return d


base = ["terrain.png", "terrain_texture.jpg", "pins.json"]
raw = gzip.decompress((B / "splat.spz").read_bytes())
magic, version, n, degree, frac, flags, _ = struct.unpack("<IIIBBBB", raw[:16])
b = np.frombuffer(raw, np.uint8, n * 9, 16).reshape(n, 3, 3).astype(np.int32)
v = b[..., 0] | b[..., 1] << 8 | b[..., 2] << 16
xyz = np.where(v & 0x800000, v - (1 << 24), v) / (1 << frac)
dx, dy = xyz[:, 0] - HERO[0], xyz[:, 1] - HERO[1]

# classtest: probabilities at offset 8..11 (contracts.md section 3), quadrant number = class
d = scene_dir("mars-hero-01-classtest", scene, base + ["splat.spz"])
rec = np.fromfile(B / "layers.bin", np.uint8).reshape(schema["count"], schema["record_bytes"]).copy()
cls = (dx < 0).astype(int) + 2 * (dy < 0).astype(int)
prob = np.full((n, 4), 18, np.uint8)
prob[np.arange(n), cls] = 201
prob[np.hypot(dx, dy) < 2.0] = 0
rec[:, 8:12] = prob
rec.tofile(d / "layers.bin")
field = {"name": "terrain_class", "type": "u8x4", "offset": 8, "labels": ["soil", "bedrock", "sand", "big_rock"],
         "scale": 255, "resolution": "test pattern",
         "source": "SYNTHETIC TEST DATA from shots/make_layer_tests.py (quadrants around the rock), not a model output"}
(d / "layers.json").write_text(json.dumps({**schema, "fields": schema["fields"] + [field]}, indent=2) + "\n")

scene_dir("mars-hero-01-ordertest", {**scene, "splat": {**scene["splat"], "order_preserved": False}},
          base + ["splat.spz", "layers.json", "layers.bin"])

d = scene_dir("mars-hero-01-counttest", scene, base + ["layers.json", "layers.bin"])
widths = [9, 1, 3, 3, 4 if version >= 3 else 3, {0: 0, 1: 9, 2: 24, 3: 45}[degree]]
keep, off, body = np.hypot(dx, dy) <= 9, 16, b""
for w in widths:
    body += np.frombuffer(raw, np.uint8, n * w, off).reshape(n, w)[keep].tobytes()
    off += n * w
(d / "splat.spz").write_bytes(gzip.compress(struct.pack("<IIIBBBB", magic, version, int(keep.sum()), degree, frac, flags, 0) + body, 6))

gray = scene["terrain"].get("texture_tint", {}).get("untinted")
if gray:
    scene_dir("mars-hero-01-graytex", {**scene, "terrain": {**scene["terrain"], "texture": gray}},
              ["terrain.png", gray, "pins.json", "splat.spz", "layers.json", "layers.bin"])
print("wrote", sorted(p.name for p in OUT.iterdir() if "test" in p.name or "graytex" in p.name))
