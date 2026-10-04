"""AI4Mars straight from the Hugging Face parquet export in data/ai4mars/data (no unpacked copy on disk).

Checked on the files, not assumed: images are 1024x1024 grayscale JPEG (Curiosity Navcam), label masks are
1024x1024 8-bit PNG with 0 soil, 1 bedrock, 2 sand, 3 big rock, 255 no label. Rover and >30 m pixels are
already 255 in the train labels. The 322 test images also sit in the train shards, but with has_labels False,
so skipping unlabelled rows keeps the test set out of training.
"""
import random
from pathlib import Path

import cv2
import numpy as np
import pyarrow.parquet as pq
import torch
from torch.utils.data import IterableDataset, get_worker_info

DATA = Path("data/ai4mars/data")
CLASSES = ["soil", "bedrock", "sand", "big_rock"]
IGNORE = 255
CROP = 512
SCALE_RANGE = (0.4, 1.0)   # of native 1024 px: covers focal lengths of about 490 to 1220 px
VAL_GROUPS_PER_SHARD = 1   # the last row group of every train shard is held out for validation


def row_groups(split):
    """(file, row group) pairs. split: 'train', 'val' (held out of train) or a test split name."""
    out = []
    for f in sorted(DATA.glob(f"{'train' if split in ('train', 'val') else split}-*.parquet")):
        n = pq.ParquetFile(f).metadata.num_row_groups
        cut = n - VAL_GROUPS_PER_SHARD
        groups = range(n) if split not in ("train", "val") else range(cut) if split == "train" else range(cut, n)
        out += [(str(f), g) for g in groups]
    return out


def count_labelled(groups):
    files = {}
    for f, g in groups:
        files.setdefault(f, []).append(g)
    return sum(sum(pq.ParquetFile(f).read_row_groups(gs, columns=["has_labels"]).column(0).to_pylist()) for f, gs in files.items())


def decode(row):
    img = cv2.imdecode(np.frombuffer(row["image"]["bytes"], np.uint8), cv2.IMREAD_GRAYSCALE)
    lab = cv2.imdecode(np.frombuffer(row["label_mask"]["bytes"], np.uint8), cv2.IMREAD_UNCHANGED)
    if lab.ndim == 3:
        lab = lab[..., 0]
    return img, lab


def augment(img, lab, rng):
    """Random scale, 512 crop, flip, and tone changes (our Perseverance frames are tone-mapped differently)."""
    s = rng.uniform(*SCALE_RANGE)
    size = max(int(round(img.shape[0] * s)), 64)
    img = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)
    lab = cv2.resize(lab, (size, size), interpolation=cv2.INTER_NEAREST)
    if size < CROP:   # pad with "no label"
        pad = CROP - size
        top, left = rng.randint(0, pad), rng.randint(0, pad)
        img = cv2.copyMakeBorder(img, top, pad - top, left, pad - left, cv2.BORDER_CONSTANT, value=0)
        lab = cv2.copyMakeBorder(lab, top, pad - top, left, pad - left, cv2.BORDER_CONSTANT, value=IGNORE)
    y, x = rng.randint(0, img.shape[0] - CROP), rng.randint(0, img.shape[1] - CROP)
    img, lab = img[y:y + CROP, x:x + CROP], lab[y:y + CROP, x:x + CROP]
    if rng.random() < 0.5:
        img, lab = img[:, ::-1], lab[:, ::-1]
    f = (img.astype(np.float32) / 255) ** rng.uniform(0.6, 1.6)                 # gamma
    f = (f - 0.5) * rng.uniform(0.7, 1.3) + 0.5 + rng.uniform(-0.1, 0.1)        # contrast, brightness
    if rng.random() < 0.25:
        f = cv2.GaussianBlur(f, (0, 0), rng.uniform(0.5, 1.5))
    if rng.random() < 0.25:
        f = f + np.random.default_rng(rng.getrandbits(32)).normal(0, rng.uniform(0.01, 0.04), f.shape).astype(np.float32)
    return np.clip(f, 0, 1).astype(np.float32), np.ascontiguousarray(lab)


class AI4Mars(IterableDataset):
    """Yields (gray float [H, W] in 0..1, label uint8 [H, W]). One row group (about 100 images) at a time.

    Rows are stored in no particular order (checked: timestamps are shuffled), so reading a shuffled list of
    row groups and shuffling inside each is as good as a global shuffle and needs no index or cache.
    """

    def __init__(self, split, train, seed=0):
        self.groups, self.train, self.seed, self.epoch = row_groups(split), train, seed, 0

    def __iter__(self):
        info = get_worker_info()
        wid, nw = (info.id, info.num_workers) if info else (0, 1)
        rng = random.Random(self.seed * 1000 + self.epoch * 100 + wid)
        groups = list(self.groups)
        if self.train:
            random.Random(self.seed * 1000 + self.epoch).shuffle(groups)   # same order in every worker
        for f, g in groups[wid::nw]:
            rows = pq.ParquetFile(f).read_row_group(g, columns=["image", "label_mask", "has_labels"]).to_pylist()
            rows = [r for r in rows if r["has_labels"] and r["label_mask"] and r["label_mask"]["bytes"]]
            if self.train:
                rng.shuffle(rows)
            for r in rows:
                img, lab = decode(r)
                if (lab == IGNORE).all():
                    continue
                if self.train:
                    img, lab = augment(img, lab, rng)
                else:
                    img = img.astype(np.float32) / 255
                yield torch.from_numpy(img), torch.from_numpy(lab)
