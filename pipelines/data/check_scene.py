#!/usr/bin/env python3
"""Is a built dataset trainable? Reads the COLMAP files gsplat will read, nothing else.

  python3 pipelines/data/check_scene.py data/colmap/cheyava_site [preview.jpg]

1. Structure: every image exists at the stated size, observations fall inside it.
2. Cross-stop alignment: points seen from one stop are projected into another stop's
   images. If poses and geometry agree, the texture they carry lines up with the texture
   found there, and the correlation peaks at zero pixel shift. A peak elsewhere is the
   misregistration in pixels; no peak means the stops do not share a frame.
3. Optional preview: one stop's points drawn into another stop's view, beside the photo.
"""
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation

SHIFT = 12   # px, half-width of the shift search


def load(root):
    sparse = Path(root) / "sparse/0"
    cams = {}
    for line in (sparse / "cameras.txt").read_text().splitlines():
        cid, _, w, h, fx, fy, cx, cy = line.split()
        cams[int(cid)] = (int(w), int(h), float(fx), float(fy), float(cx), float(cy))
    images = []
    lines = (sparse / "images.txt").read_text().split("\n")
    for head, obs in zip(lines[0::2], lines[1::2]):
        if not head.strip():
            continue
        iid, qw, qx, qy, qz, tx, ty, tz, cid, name = head.split()
        o = np.array(obs.split(), float).reshape(-1, 3)
        images.append(dict(name=name, R=Rotation.from_quat([float(qx), float(qy), float(qz), float(qw)]).as_matrix(),
                           t=np.array([float(tx), float(ty), float(tz)]), cam=cams[int(cid)], xy=o[:, :2], pid=o[:, 2].astype(int)))
    pts = {}
    with open(sparse / "points3D.txt") as f:
        for line in f:
            p = line.split(maxsplit=7)
            pts[int(p[0])] = [float(v) for v in p[1:7]]
    return images, pts


def project(im, X):
    w, h, fx, fy, cx, cy = im["cam"]
    pc = X @ im["R"].T + im["t"]
    z = np.where(pc[:, 2] > 0.05, pc[:, 2], np.nan)
    uv = np.stack([fx * pc[:, 0] / z + cx, fy * pc[:, 1] / z + cy], 1)
    with np.errstate(invalid="ignore"):
        return uv, (uv[:, 0] >= SHIFT + 1) & (uv[:, 0] < w - SHIFT - 2) & (uv[:, 1] >= SHIFT + 1) & (uv[:, 1] < h - SHIFT - 2)


def texture(path):
    """Grey with the local mean removed: what is left is rock and pebble texture, not lighting."""
    g = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE).astype(np.float32)
    return cv2.GaussianBlur(g, (0, 0), 1.5) - cv2.GaussianBlur(g, (0, 0), 8)


def main(root, preview=None):
    root = Path(root)
    images, pts = load(root)
    ids = np.array(sorted(pts))
    index = {p: i for i, p in enumerate(ids)}
    X = np.array([pts[p][:3] for p in ids])

    # 1. structure
    for im in images:
        size = cv2.imread(str(root / "images" / im["name"])).shape[:2][::-1]
        assert size == im["cam"][:2], f"{im['name']}: file is {size}, camera says {im['cam'][:2]}"
        assert len(im["xy"]) and (im["xy"] >= 0).all() and (im["xy"] < size).all(), f"{im['name']}: observations outside the image"
        uv, _ = project(im, X[[index[p] for p in im["pid"][::97]]])
        assert np.abs(uv - im["xy"][::97]).max() < 1.0, f"{im['name']}: stored observations do not reproject"
    stop_of = lambda im: im["name"].split("_")[0]
    by_stop = defaultdict(list)
    for im in images:
        by_stop[stop_of(im)].append(im)
    print(f"structure ok: {len(images)} images, {len(X)} points, stops {({s: len(v) for s, v in by_stop.items()})}")

    # 2. cross-stop alignment, Navcam only (similar pixel scale on the ground)
    tex = {im["name"]: texture(root / "images" / im["name"]) for im in images if "_nav" in im["name"]}
    worst = 0.0
    for a in by_stop:
        val = np.full(len(X), np.nan)   # texture each point carries, sampled where stop a saw it
        for im in by_stop[a]:
            if im["name"] in tex:
                k = np.array([index[p] for p in im["pid"]])
                val[k] = tex[im["name"]][im["xy"][:, 1].astype(int), im["xy"][:, 0].astype(int)]
        mine = np.nonzero(np.isfinite(val))[0]
        for b in by_stop:
            if b == a:
                continue
            A, B = [], []
            for im in by_stop[b]:
                if im["name"] not in tex:
                    continue
                uv, ok = project(im, X[mine])
                u, v = uv[ok, 0].round().astype(int), uv[ok, 1].round().astype(int)
                A.append(val[mine[ok]])
                B.append(np.stack([tex[im["name"]][v + dy, u + dx] for dy in range(-SHIFT, SHIFT + 1) for dx in range(-SHIFT, SHIFT + 1)], 1))
            A, B = np.concatenate(A), np.concatenate(B)
            corr = ((A - A.mean())[:, None] * (B - B.mean(0))).mean(0) / (A.std() * B.std(0))
            corr = corr.reshape(2 * SHIFT + 1, 2 * SHIFT + 1)
            dy, dx = np.unravel_index(corr.argmax(), corr.shape)
            edge = np.concatenate([corr[0], corr[-1], corr[:, 0], corr[:, -1]])
            off = float(np.hypot(dx - SHIFT, dy - SHIFT))
            worst = max(worst, off)
            print(f"  {a} points in {b} images: {len(A):6d} samples, peak corr {corr.max():.3f} at shift ({dx - SHIFT:+d},{dy - SHIFT:+d}) px, "
                  f"corr at +-{SHIFT} px {edge.mean():.3f}")
    print(f"cross-stop alignment: worst peak offset {worst:.1f} px")

    # 3. preview: the first stop's points in the widest view of the second
    if preview:
        a, b = list(by_stop)[:2]
        im = max((i for i in by_stop[b] if "_nav" in i["name"]), key=lambda i: i["cam"][0] * i["cam"][1])
        photo = cv2.imread(str(root / "images" / im["name"]))
        own = np.zeros(len(X), bool)
        for other in by_stop[a]:
            own[[index[p] for p in other["pid"]]] = True
        uv, ok = project(im, X[own])
        rgb = np.array([pts[p][3:] for p in ids[own]], np.uint8)[ok][:, ::-1]
        canvas = np.zeros_like(photo)
        for (u, v), c in zip(uv[ok].astype(int), rgb):
            cv2.circle(canvas, (int(u), int(v)), 2, c.tolist(), -1)
        cv2.imwrite(preview, np.hstack([photo, canvas]))
        print(f"preview: {im['name']} (photo from {b}) beside points measured from {a} -> {preview}")
    assert worst <= 3.0, "stops are misaligned by more than 3 px: do not train on this"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:3])
