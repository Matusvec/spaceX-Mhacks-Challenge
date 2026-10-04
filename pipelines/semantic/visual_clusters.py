#!/usr/bin/env python3
"""Visual-semantics layer: region CLIP embeddings -> 16-d latents -> lifted onto Gaussians -> 256 clusters.

  .venv-semantic/bin/python pipelines/semantic/visual_clusters.py <splat.ply> [--scene data/colmap/cheyava_site_v4]

Needs embed_regions.py to have run on the scene. Follows docs/semantic-layers.md layer 5, in its order:
  1. autoencoder 512-256-128-64-16 and mirror, trained on every region embedding (MSE + cosine loss)
  2. each region's 16-d latent is lifted onto the Gaussians that see it, with lift_terrain's projection and
     occlusion test (centres, not the rasterizer blending-weight lift), averaged over images by 1 / depth^2
  3. k-means, k = 256, on the latents of the Gaussians that were seen

Writes next to the PLY:
  <stem>.visual.npz      cluster u16 [N] (65535 = seen by no region), latent f16 [N, 16], weight, views, meta
  <stem>.clusters.json   docs/contracts.md section 4
and runs/semantic/ae_decoder.pt (TorchScript, 16 -> 512; the contract's apps/backend/models/ does not exist yet)
and runs/semantic/ae.pt (encoder and decoder weights).
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from scipy.cluster.vq import kmeans2, vq

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
import clip_model  # noqa: E402
from check_scene import load as load_colmap  # noqa: E402
from embed_regions import NONE  # noqa: E402
from export_scene import load_ply  # noqa: E402
from lift_terrain import DEPTH_TOL, MAX_RANGE_M, OCCLUDER_OPACITY, observe  # noqa: E402

OUT = Path("runs/semantic")
LATENT, K = 16, 256
WIDTHS = [clip_model.EMBED_DIM, 256, 128, 64, LATENT]
AE_STEPS, AE_BATCH = 4000, 1024
KMEANS_SAMPLE = 300_000   # ponytail: centroids are fitted on a sample, then every Gaussian is assigned


def mlp(widths):
    layers = []
    for a, b in zip(widths[:-1], widths[1:]):
        layers += [torch.nn.Linear(a, b), torch.nn.GELU()]
    return torch.nn.Sequential(*layers[:-1])


def train_autoencoder(emb, seed=0):
    """emb: unit vectors [M, 512]. -> encoder, decoder (on the GPU), held-out reconstruction cosines."""
    torch.manual_seed(seed)
    perm = torch.randperm(len(emb))
    held, train = emb[perm[: len(emb) // 10]].cuda(), emb[perm[len(emb) // 10:]].cuda()
    enc, dec = mlp(WIDTHS).cuda(), mlp(WIDTHS[::-1]).cuda()
    opt = torch.optim.Adam([*enc.parameters(), *dec.parameters()], lr=1e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, AE_STEPS)
    for _ in range(AE_STEPS):
        x = train[torch.randint(len(train), (AE_BATCH,), device="cuda")]
        y = dec(enc(x))
        loss = F.mse_loss(y, x) + (1 - F.cosine_similarity(y, x, dim=-1)).mean()
        opt.zero_grad(), loss.backward(), opt.step(), sched.step()
    with torch.no_grad():
        cos = F.cosine_similarity(dec(enc(held)), held, dim=-1).cpu().numpy()
    return enc.eval(), dec.eval(), cos


def lift_latents(g, images, regions, latents):
    """-> mean latent [N, 16] (zeros if unseen), weight [N], views [N]."""
    n = len(g["xyz"])
    acc, weight, views = np.zeros((n, LATENT), np.float64), np.zeros(n, np.float64), np.zeros(n, np.uint16)
    occluder = g["opacity"] >= np.log(OCCLUDER_OPACITY / (1 - OCCLUDER_OPACITY))
    radius = np.exp(g["scale"].max(1))
    for im in images:
        stem = Path(im["name"]).stem
        ids = cv2.imread(str(regions / "maps" / f"{stem}.png"), cv2.IMREAD_UNCHANGED)
        assert ids is not None and ids.shape == (im["cam"][1], im["cam"][0]), f"no region map for {im['name']}"
        idx, uv, depth = observe(im, g["xyz"], radius, occluder)
        region = ids[uv[:, 1].astype(int), uv[:, 0].astype(int)]
        ok = region != NONE
        idx, wt = idx[ok], 1.0 / np.maximum(depth[ok], 1.0) ** 2
        acc[idx] += latents[stem][region[ok]] * wt[:, None]
        weight[idx] += wt
        views[idx] += 1
    seen = weight > 0
    acc[seen] /= weight[seen, None]
    return acc.astype(np.float32), weight.astype(np.float32), views


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ply")
    ap.add_argument("--scene", default="data/colmap/cheyava_site_v4")
    ap.add_argument("--regions", help="default: runs/semantic/regions/<scene name>")
    args = ap.parse_args()
    scene, ply = Path(args.scene), Path(args.ply)
    regions = Path(args.regions) if args.regions else OUT / "regions" / scene.name
    images, _ = load_colmap(scene)
    stems = [Path(im["name"]).stem for im in images]
    emb = {s: torch.from_numpy(np.load(regions / "emb" / f"{s}.npy").astype(np.float32)) for s in stems}
    all_emb = torch.cat(list(emb.values()))
    print(f"{len(all_emb)} regions in {len(images)} images")

    # One autoencoder per set of regions: a second splat of the same scene reuses it, so every clusters.json
    # made from these regions is decoded by the same runs/semantic/ae_decoder.pt.
    trained_on = {"regions": str(regions), "count": len(all_emb)}
    saved = torch.load(OUT / "ae.pt", weights_only=True) if (OUT / "ae.pt").exists() else {}
    if saved.get("trained_on") == trained_on:
        enc = mlp(WIDTHS).cuda().eval()
        enc.load_state_dict(saved["encoder"])
        cos_mean = saved["heldout_cosine_mean"]
        print(f"autoencoder: reusing {OUT / 'ae.pt'} (held-out reconstruction cosine mean {cos_mean:.3f})")
    else:
        enc, dec, cos = train_autoencoder(all_emb)
        cos_mean = float(cos.mean())
        print(f"autoencoder: held-out reconstruction cosine mean {cos_mean:.3f}, 5th percentile {np.percentile(cos, 5):.3f}")
        OUT.mkdir(parents=True, exist_ok=True)
        torch.save({"widths": WIDTHS, "encoder": enc.state_dict(), "decoder": dec.state_dict(), "trained_on": trained_on,
                    "heldout_cosine_mean": cos_mean}, OUT / "ae.pt")
        torch.jit.trace(dec.cpu(), torch.zeros(1, LATENT)).save(str(OUT / "ae_decoder.pt"))
    with torch.no_grad():
        latents = {s: enc(e.cuda()).cpu().numpy() for s, e in emb.items()}

    g = load_ply(ply)
    lat, weight, views = lift_latents(g, images, regions, latents)
    seen = weight > 0
    rng = np.random.default_rng(0)
    sample = lat[seen][rng.choice(seen.sum(), min(KMEANS_SAMPLE, seen.sum()), replace=False)].astype(np.float64)
    centroids, _ = kmeans2(sample, K, iter=30, minit="++", seed=0, missing="warn")
    cluster = np.full(len(lat), NONE, np.uint16)
    cluster[seen] = vq(lat[seen].astype(np.float64), centroids)[0]
    sizes = np.bincount(cluster[seen], minlength=K)

    method = ("region latents projected onto Gaussian centres seen in posed rover images (occlusion by a z-buffer of opaque "
              f"Gaussians, {DEPTH_TOL:.0%} depth tolerance, within {MAX_RANGE_M:g} m), averaged over images by 1/depth^2; "
              "not the rasterizer blending-weight lift of docs/semantic-layers.md")
    summary = json.loads((regions / "summary.json").read_text())
    meta = {"ply": str(ply), "count": len(lat), "scene": str(scene), "images_used": len(images), "regions": len(all_emb),
            "segmenter": summary["segmenter"], "encoder": clip_model.ENCODER, "method": method,
            "seen_fraction": round(float(seen.mean()), 4), "ae_heldout_cosine_mean": round(cos_mean, 4)}
    stem = str(ply)[: -len(ply.suffix)]
    np.savez_compressed(stem + ".visual.npz", cluster=cluster, latent=lat.astype(np.float16), weight=weight, views=views,
                        meta=json.dumps(meta))
    Path(stem + ".clusters.json").write_text(json.dumps({
        "encoder": clip_model.ENCODER, "embed_dim": clip_model.EMBED_DIM, "latent_dim": LATENT, "k": K,
        "centroids_latent": np.round(centroids, 5).tolist(),
        "decoder": f"{OUT / 'ae_decoder.pt'} (TorchScript, latent [n, 16] -> embedding [n, 512], normalise the output); "
                   "the contract's apps/backend/models/ae_decoder.pt should be a copy of it",
        "cluster_sizes": sizes.tolist(), **{k: meta[k] for k in ("segmenter", "method", "scene", "ply")}}) + "\n")
    print(json.dumps(meta, indent=1))
    print(f"clusters: {(sizes > 0).sum()} of {K} used, sizes min/median/max {sizes.min()}/{int(np.median(sizes))}/{sizes.max()}")


if __name__ == "__main__":
    main()
