#!/usr/bin/env python3
"""Cut every image of a COLMAP dataset into regions and give each region a CLIP embedding.

  .venv-semantic/bin/python pipelines/semantic/embed_regions.py data/colmap/cheyava_site_v4

Regions: SAM ViT-B automatic masks (facebook/sam-vit-base through transformers; the spec's SAM, its smallest
size). SAM leaves large uniform areas (a sand sheet, a rock face) without a mask, so every connected piece of
uncovered image larger than MIN_BACKGROUND becomes a region too. Where masks overlap the smaller one wins.

Embedding: the region alone on black (masked_crop), CLIP = clip_model.ENCODER.

Writes to runs/semantic/regions/<dataset>/:
  maps/<image>.png      16-bit region id per pixel at image size, 65535 = no region
  emb/<image>.npy       float16 [regions, 512] unit vectors, row = region id
  preview/<image>.jpg   the photo beside its regions
  summary.json
Images already done are skipped, so the run can be resumed.
"""
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import clip_model

SAM = "facebook/sam-vit-base"
POINTS_PER_SIDE = 32
MIN_MASK = 0.0004         # of the image area: smaller masks are a few dozen pixels, too little for CLIP
MIN_BACKGROUND = 0.005    # uncovered pieces at least this large become regions
NONE = 65535


def sam_masks(generator, rgb):
    """-> list of bool masks: SAM's, then the uncovered pieces, each at least its minimum area."""
    # SAM returns its masks at image size on the GPU, three per point: batch fewer points on large frames (8 GB card)
    batch = int(np.clip(64 * 1.2e6 / (rgb.shape[0] * rgb.shape[1]), 8, 64))
    out = generator(Image.fromarray(rgb), points_per_batch=batch, points_per_crop=POINTS_PER_SIDE,
                    pred_iou_thresh=0.86, stability_score_thresh=0.9)
    masks = [np.asarray(m, bool) for m in out["masks"]]
    masks = [m for m in masks if m.mean() >= MIN_MASK]
    covered = np.any(masks, 0) if masks else np.zeros(rgb.shape[:2], bool)
    n, labels, stats, _ = cv2.connectedComponentsWithStats((~covered).astype(np.uint8), connectivity=4)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_BACKGROUND * covered.size:
            masks.append(labels == i)
    return masks


def region_map(masks, shape):
    """Region id per pixel; large masks are painted first so a smaller mask inside wins."""
    ids = np.full(shape, NONE, np.uint16)
    for i in sorted(range(len(masks)), key=lambda i: -masks[i].sum()):
        ids[masks[i]] = i
    return ids


def masked_crop(rgb, mask):
    """The region alone on black, cut to its box (as LangSplat does).

    Checked on ten hand-picked regions (boulders, slabs, dune, ripples, telephoto sand and rock face): this
    separates them best (mean pairwise cosine 0.69; a box with surrounding context gave 0.80, and gave two
    large regions of one image the same embedding because their boxes are the same picture).
    """
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return np.where(mask[y0:y1, x0:x1, None], rgb[y0:y1, x0:x1], 0)


def embed_regions(model, rgb, masks):
    """-> unit vectors [len(masks), 512]."""
    return clip_model.embed_crops(model, [masked_crop(rgb, m) for m in masks])


def preview(rgb, ids, width=700):
    rng = np.random.default_rng(0)
    colours = rng.integers(40, 255, (int(ids[ids != NONE].max(initial=0)) + 1, 3)).astype(np.uint8)
    bgr = rgb[:, :, ::-1]
    tint = np.where((ids != NONE)[..., None], (0.45 * bgr + 0.55 * colours[np.minimum(ids, len(colours) - 1)]).astype(np.uint8), bgr // 3)
    both = np.hstack([bgr, tint])
    return cv2.resize(both, (2 * width, round(rgb.shape[0] * width / rgb.shape[1])), interpolation=cv2.INTER_AREA)


def main(root):
    from transformers import pipeline
    root = Path(root)
    out = Path("runs/semantic/regions") / root.name
    for d in ("maps", "emb", "preview"):
        (out / d).mkdir(parents=True, exist_ok=True)
    generator = pipeline("mask-generation", model=SAM, device=0)
    model, _ = clip_model.load()
    names = sorted(p.name for p in (root / "images").glob("*.jpg"))
    t0, done = time.time(), 0
    for name in names:
        stem = Path(name).stem
        if (out / "emb" / f"{stem}.npy").exists():
            continue
        rgb = cv2.cvtColor(cv2.imread(str(root / "images" / name)), cv2.COLOR_BGR2RGB)
        masks = sam_masks(generator, rgb)
        ids = region_map(masks, rgb.shape[:2])
        emb = embed_regions(model, rgb, masks).numpy().astype(np.float16)
        cv2.imwrite(str(out / "maps" / f"{stem}.png"), ids)
        cv2.imwrite(str(out / "preview" / f"{stem}.jpg"), preview(rgb, ids), [cv2.IMWRITE_JPEG_QUALITY, 80])
        np.save(out / "emb" / f"{stem}.npy", emb)   # last, so a half-written image is redone
        done += 1
        print(f"{name}: {len(masks)} regions, {(ids != NONE).mean():.0%} covered, {(time.time() - t0) / done:.1f} s/image", flush=True)
    counts = {Path(n).stem: len(np.load(out / "emb" / f"{Path(n).stem}.npy")) for n in names}
    (out / "summary.json").write_text(json.dumps({
        "dataset": str(root), "segmenter": f"{SAM} automatic masks ({POINTS_PER_SIDE}x{POINTS_PER_SIDE} points) plus uncovered pieces",
        "encoder": clip_model.ENCODER, "embedding": "region on black, cut to its box, padded square, 224 px",
        "images": len(names), "regions": sum(counts.values()), "regions_per_image": counts}, indent=1) + "\n")
    print(f"{len(names)} images, {sum(counts.values())} regions -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
