#!/usr/bin/env python3
"""Run the AI4Mars terrain model on a COLMAP dataset's images.

  .venv-semantic/bin/python pipelines/semantic/predict_terrain.py data/colmap/cheyava_site_v2

Writes to runs/ai4mars/pred/<dataset>/:
  probs/<image>.png     4-channel 8-bit PNG, channels = P(soil), P(bedrock), P(sand), P(big_rock) * 255,
                        at half the resolution the model saw (the network's own output is a quarter of it)
  overlay/<image>.jpg   photo beside the photo tinted by the most likely class, to judge by eye
  summary.json          per image: model input scale, class fractions, mean confidence

Images are converted to grey first (AI4Mars is grey Curiosity Navcam) and resized so their focal length in
pixels is near what the model was trained on: Curiosity Navcam is about 1220 px at 1024 px, and training
used 0.4 to 1.0 of that. A 110 mm Mastcam-Z frame (about 14800 px) cannot be brought into that range without
shrinking it to a thumbnail, so it is only shrunk to MIN_SIDE and is out of distribution: see summary.json's
"in_training_scale" flag and look at the overlays before lifting those.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
from ai4mars_data import CLASSES  # noqa: E402
from check_scene import load as load_colmap  # noqa: E402
from seg_model import load, logits  # noqa: E402

CHECKPOINT = Path("runs/ai4mars/best.pt")
TARGET_FOCAL_PX = 900.0     # inside the trained range of about 490 to 1220 px
TRAINED_FOCAL_PX = (490.0, 1220.0)
THUMBNAIL = 256             # if matching the focal length leaves the long side under this (telephoto) ...
MIN_SIDE = 512              # ... shrink only to this long side instead, and flag the image as out of range
COLOURS_BGR = np.array([[90, 150, 200], [220, 120, 50], [60, 220, 240], [50, 50, 220]], np.uint8)  # tan, blue, yellow, red


def model_scale(width, height, focal):
    s = min(1.0, TARGET_FOCAL_PX / focal)
    return s if s * max(width, height) >= THUMBNAIL else min(1.0, MIN_SIDE / max(width, height))


def overlay(photo, probs, width=1100):
    """Photo next to the class tint; pixels where no class reaches 0.5 are left untinted."""
    h = int(photo.shape[0] * width / photo.shape[1])
    photo = cv2.resize(photo, (width, h), interpolation=cv2.INTER_AREA)
    p = cv2.resize(probs, (width, h), interpolation=cv2.INTER_LINEAR)
    grey = cv2.cvtColor(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    tint = (0.5 * grey + 0.5 * COLOURS_BGR[p.argmax(2)]).astype(np.uint8)
    tint = np.where((p.max(2) >= 128)[..., None], tint, grey)
    for i, name in enumerate(CLASSES):
        cv2.rectangle(tint, (8 + 120 * i, 8), (24 + 120 * i, 24), COLOURS_BGR[i].tolist(), -1)
        cv2.putText(tint, name, (28 + 120 * i, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return np.hstack([photo, tint])


@torch.no_grad()
def main(root):
    root = Path(root)
    out = Path("runs/ai4mars/pred") / root.name
    (out / "probs").mkdir(parents=True, exist_ok=True)
    (out / "overlay").mkdir(exist_ok=True)
    # The laptop GPU is shared with other jobs: fall back to the CPU (a few seconds per image) when it is full.
    device = "cuda" if torch.cuda.is_available() and torch.cuda.mem_get_info()[0] > 2 * 1024 ** 3 else "cpu"
    model = load(CHECKPOINT, device)
    images, _ = load_colmap(root)
    summary = {"checkpoint": str(CHECKPOINT), "classes": CLASSES, "images": {}}
    for im in images:
        w, h, focal = im["cam"][:3]
        photo = cv2.imread(str(root / "images" / im["name"]))
        s = model_scale(w, h, focal)
        size = (max(round(w * s), 32), max(round(h * s), 32))
        grey = cv2.resize(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY), size, interpolation=cv2.INTER_AREA)
        x = torch.from_numpy(grey).to(device).float()[None] / 255
        with torch.autocast("cuda", dtype=torch.float16, enabled=device == "cuda"):
            lg = logits(model, x, out_size=(size[1] // 2, size[0] // 2))
            lg = lg + logits(model, x.flip(-1), out_size=(size[1] // 2, size[0] // 2)).flip(-1)   # mirror average
        probs = (lg.float() / 2).softmax(1)[0].permute(1, 2, 0).cpu().numpy()
        p8 = np.round(probs * 255).astype(np.uint8)
        stem = Path(im["name"]).stem
        cv2.imwrite(str(out / "probs" / f"{stem}.png"), p8)   # channel order as given: no BGR meaning
        cv2.imwrite(str(out / "overlay" / f"{stem}.jpg"), overlay(photo, p8), [cv2.IMWRITE_JPEG_QUALITY, 85])
        frac = np.bincount(probs.argmax(2).ravel(), minlength=4) / probs[..., 0].size
        summary["images"][im["name"]] = {
            "focal_px": round(focal, 1), "model_scale": round(s, 4), "model_focal_px": round(focal * s, 1),
            "in_training_scale": bool(TRAINED_FOCAL_PX[0] <= focal * s <= TRAINED_FOCAL_PX[1]),
            "class_fraction": dict(zip(CLASSES, frac.round(4).tolist())), "mean_confidence": round(float(probs.max(2).mean()), 4)}
    (out / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    ins = [v for v in summary["images"].values() if v["in_training_scale"]]
    print(f"{len(images)} images -> {out}; {len(ins)} at a trained scale, {len(images) - len(ins)} out of range (telephoto)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
