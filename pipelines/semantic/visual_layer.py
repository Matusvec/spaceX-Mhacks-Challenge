#!/usr/bin/env python3
"""Put the visual-semantic clusters into a scene bundle (docs/contracts.md sections 3 and 4).

  .venv-semantic/bin/python pipelines/semantic/visual_layer.py <bundle> <ply stem>.visual.npz <kept_index.npy>
  .venv-semantic/bin/python pipelines/semantic/visual_layer.py --self-check

Fills `visual_cluster` (u16 at byte 18) of every layers.bin record, lists the field in layers.json, copies
<ply stem>.clusters.json to <bundle>/clusters.json and points scene.json at it. kept_index[i] is the row of the
full PLY that became Gaussian i of splat.spz. export_scene.py rewrites layers.bin, so run this after every export.
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

OFFSET, NONE = 18, 65535


def write_visual_cluster(bundle, npz, kept_index):
    bundle, npz = Path(bundle), Path(npz)
    data = np.load(npz)
    meta, schema = json.loads(str(data["meta"])), json.loads((bundle / "layers.json").read_text())
    kept_index = np.asarray(kept_index)
    n, size = schema["count"], schema["record_bytes"]
    if len(kept_index) != n:
        raise SystemExit(f"index has {len(kept_index)} entries, layers.json counts {n} Gaussians")
    if len(data["cluster"]) != meta["count"] or kept_index.max() >= meta["count"]:
        raise SystemExit(f"the clusters cover {meta['count']} Gaussians ({meta['ply']}); the index points past it")
    clusters_json = Path(str(npz)[: -len(".visual.npz")] + ".clusters.json")
    k = json.loads(clusters_json.read_text())["k"]
    values = data["cluster"][kept_index]
    assert ((values < k) | (values == NONE)).all(), "cluster id outside clusters.json"
    records = np.memmap(bundle / "layers.bin", np.uint8, "r+", shape=(n, size))
    records[:, OFFSET:OFFSET + 2] = values.astype("<u2").view(np.uint8).reshape(n, 2)
    records.flush()
    field = {
        "name": "visual_cluster", "type": "u16", "offset": OFFSET, "none": NONE,
        "source": f"{meta['segmenter']} + {meta['encoder']} region embeddings, lifted, autoencoder, k-means",
        "resolution": "one embedding per image region (a rock, a slab, a sand patch: centimetres in Mastcam-Z, "
                      "decimetres to metres in Navcam), one cluster id per Gaussian centre; only within 30 m of a camera",
        "estimate": True,
        "known_fraction": round(float((values != NONE).mean()), 4),
        "method": meta["method"],
        "note": "clusters group regions that look alike to a general-purpose image model; they are not rock types",
    }
    schema["fields"] = [f for f in schema["fields"] if f["name"] != "visual_cluster"] + [field]
    (bundle / "layers.json").write_text(json.dumps(schema, indent=2) + "\n")
    shutil.copyfile(clusters_json, bundle / "clusters.json")
    scene = json.loads((bundle / "scene.json").read_text())
    scene["clusters"] = "clusters.json"
    (bundle / "scene.json").write_text(json.dumps(scene, indent=2) + "\n")
    return field


def self_check():
    """Ids land at byte 18 in bundle order, little-endian; the other bytes survive; a second write replaces the first."""
    rng = np.random.default_rng(0)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        full, n = 60, 25
        before = rng.integers(0, 256, (n, 24), dtype=np.uint8)
        before.tofile(tmp / "layers.bin")
        (tmp / "layers.json").write_text(json.dumps({"count": n, "record_bytes": 24, "fields": [
            {"name": "target_id", "type": "u16", "offset": 14}, {"name": "terrain_class", "type": "u8x4", "offset": 8}]}))
        (tmp / "scene.json").write_text(json.dumps({"scene_id": "t"}))
        cluster = rng.integers(0, 256, full).astype(np.uint16)
        cluster[::7] = NONE
        np.savez(tmp / "s.visual.npz", cluster=cluster, meta=json.dumps(
            {"count": full, "ply": "s.ply", "method": "test", "segmenter": "seg", "encoder": "enc"}))
        (tmp / "s.clusters.json").write_text(json.dumps({"k": 256, "centroids_latent": []}))
        kept = rng.permutation(full)[:n]
        for _ in range(2):
            write_visual_cluster(tmp, tmp / "s.visual.npz", kept)
        after = np.fromfile(tmp / "layers.bin", np.uint8).reshape(n, 24)
        assert (np.frombuffer(after[:, 18:20].tobytes(), "<u2") == cluster[kept]).all()
        assert (after[:, :18] == before[:, :18]).all() and (after[:, 20:] == before[:, 20:]).all()
        fields = json.loads((tmp / "layers.json").read_text())["fields"]
        assert [f["name"] for f in fields] == ["target_id", "terrain_class", "visual_cluster"] and fields[-1]["estimate"] is True
        assert json.loads((tmp / "scene.json").read_text()) == {"scene_id": "t", "clusters": "clusters.json"}
        assert (tmp / "clusters.json").exists()
    print("self-check ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-check"]:
        self_check()
    elif len(sys.argv) == 4:
        print(json.dumps(write_visual_cluster(sys.argv[1], sys.argv[2], np.load(sys.argv[3])), indent=1))
    else:
        sys.exit(__doc__)
