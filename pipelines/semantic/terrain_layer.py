#!/usr/bin/env python3
"""Put a terrain-class lift into a scene bundle's layers.bin / layers.json (docs/contracts.md section 3).

    from terrain_layer import write_terrain_class
    write_terrain_class("scenes/mars-hero-01", "runs/ai4mars/lift/<name>.npz", kept_index)

kept_index[i] is the row of the full PLY that became Gaussian i of splat.spz (the export's crop and prune,
in order). The lift must have been made from that same PLY.

  .venv-semantic/bin/python pipelines/semantic/terrain_layer.py <bundle> <lift.npz> <kept_index.npy>
  .venv-semantic/bin/python pipelines/semantic/terrain_layer.py --self-check

export_scene.py rewrites layers.bin from scratch, so run this again after every export.
"""
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

OFFSET, LABELS = 8, ["soil", "bedrock", "sand", "big_rock"]
TEST_METRICS = Path("runs/ai4mars/test_metrics.json")


def write_terrain_class(bundle, npz, kept_index):
    """Fill bytes 8..11 of every layers.bin record and list the field in layers.json. Returns the field."""
    bundle, lift = Path(bundle), np.load(npz)
    meta, schema = json.loads(str(lift["meta"])), json.loads((bundle / "layers.json").read_text())
    kept_index = np.asarray(kept_index)
    n, size = schema["count"], schema["record_bytes"]
    if len(kept_index) != n:
        raise SystemExit(f"index has {len(kept_index)} entries, layers.json counts {n} Gaussians")
    if len(lift["probs"]) != meta["count"] or kept_index.max() >= meta["count"]:
        raise SystemExit(f"the lift covers {meta['count']} Gaussians ({meta['ply']}); the index points past it")
    for f in schema["fields"]:
        if f["name"] != "terrain_class" and f["offset"] < OFFSET + 4 and OFFSET < f["offset"] + {"f16": 2, "u16": 2}.get(f["type"], 4):
            raise SystemExit(f"field {f['name']} overlaps bytes {OFFSET}..{OFFSET + 3}")
    records = np.memmap(bundle / "layers.bin", np.uint8, "r+", shape=(n, size))
    values = lift["probs"][kept_index]
    records[:, OFFSET:OFFSET + 4] = values
    records.flush()
    field = {
        "name": "terrain_class", "type": "u8x4", "offset": OFFSET, "labels": LABELS, "scale": 255,
        "source": "our AI4Mars-trained model",
        # predict_terrain.py feeds the model at a 900 px focal length and SegFormer answers at a quarter of
        # that: 1 / 225 rad per output pixel = 4.4 cm across at 10 m (longer along the ground at grazing angles).
        "resolution": ("per pixel in rover Navcam images, about 4 cm across at 10 m range (the model's output grid), "
                       "one value per Gaussian centre; only within 30 m of a camera"),
        "estimate": True,
        "unknown": "all four bytes 0: no rover image saw this Gaussian",
        "known_fraction": round(float(values.any(1).mean()), 4),
        "method": meta["method"],
        "model": "SegFormer-B1 fine-tuned on AI4Mars (Curiosity Navcam, grey); applied to Perseverance Navcam, a different rover",
    }
    if TEST_METRICS.exists():
        t = json.loads(TEST_METRICS.read_text())
        field["model_test_miou_ai4mars"] = {k: round(t[k]["miou"], 4) for k in ("test_min1", "test_min2", "test_min3") if k in t}
    schema["fields"] = [f for f in schema["fields"] if f["name"] != "terrain_class"] + [field]
    (bundle / "layers.json").write_text(json.dumps(schema, indent=2) + "\n")
    return field


def self_check():
    """Bytes land at offset 8 in bundle order, other fields survive, a second write replaces the first."""
    rng = np.random.default_rng(0)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        full, n = 50, 20
        before = rng.integers(0, 256, (n, 24), dtype=np.uint8)
        before.tofile(tmp / "layers.bin")
        (tmp / "layers.json").write_text(json.dumps({"count": n, "record_bytes": 24, "fields": [
            {"name": "height_above_ground_m", "type": "f16", "offset": 6}, {"name": "target_id", "type": "u16", "offset": 14}]}))
        probs = rng.integers(0, 256, (full, 4), dtype=np.uint8)
        np.savez(tmp / "lift.npz", probs=probs, meta=json.dumps({"count": full, "ply": "x.ply", "method": "test"}))
        kept = rng.permutation(full)[:n]
        for _ in range(2):
            write_terrain_class(tmp, tmp / "lift.npz", kept)
        after = np.fromfile(tmp / "layers.bin", np.uint8).reshape(n, 24)
        assert (after[:, 8:12] == probs[kept]).all()
        assert (after[:, :8] == before[:, :8]).all() and (after[:, 12:] == before[:, 12:]).all()
        fields = json.loads((tmp / "layers.json").read_text())["fields"]
        assert [f["name"] for f in fields] == ["height_above_ground_m", "target_id", "terrain_class"]
        assert fields[-1]["source"] == "our AI4Mars-trained model" and fields[-1]["resolution"]
    print("self-check ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-check"]:
        self_check()
    elif len(sys.argv) == 4:
        print(json.dumps(write_terrain_class(sys.argv[1], sys.argv[2], np.load(sys.argv[3])), indent=1))
    else:
        sys.exit(__doc__)
