#!/usr/bin/env python3
"""Ask the visual-semantic clusters a question in words and look at the answer.

  .venv-semantic/bin/python pipelines/semantic/query_clusters.py "light-toned layered rock" \
      [--ply runs/cheyava-site-v4/ply/point_cloud_29999.ply] [--scene data/colmap/cheyava_site_v4] [--z 1.0]

The text is embedded with the same CLIP as the regions; the 256 cluster centroids are decoded from 16 to 512
dimensions; each cluster gets a LangSplat-style relevancy, sigmoid(10 * (cos(text) - max cos(negative))), against
"object", "things", "stuff", "texture".

Which clusters answer the query: a fixed relevancy threshold does not work here (measured: at 0.5 it keeps all
256 clusters for "light-toned layered rock" and 7 for "wheel tracks"), because every Mars region sits about
equally far from the generic negatives. So relevancy is standardised over the 256 clusters and the clusters at
least --z standard deviations above the mean are kept: "what stands out in this scene for this text".

They are drawn from red (just above the threshold) to yellow (z of 3 or more) in a top-down view and
re-projected into photos: the two fixed overview photos, plus the two (from different exposures) that show the
most highlighted Gaussians. Writes runs/semantic/queries/<text>.jpg and prints the ranking.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
import clip_model  # noqa: E402
from check_scene import load as load_colmap  # noqa: E402
from export_scene import load_ply  # noqa: E402
from lift_terrain import MAX_RANGE_M, OCCLUDER_OPACITY, observe  # noqa: E402
from render_topdown import panel, splat_colours, window  # noqa: E402

NEGATIVES = ["object", "things", "stuff", "texture"]
FIXED_PHOTOS = ["s55d144_navL_1204_0773825117_0.jpg", "s56d0_navL_1210_0774361908_1.jpg"]
DECODER = Path("runs/semantic/ae_decoder.pt")
PANEL_W, TOPDOWN_M, TOPDOWN_RES = 700, 16.0, 0.02


def rank_clusters(text, centroids_latent, model=None, tokenizer=None):
    """-> relevancy [k] in 0..1 and cosine to the text [k]. This is all the backend needs for a query."""
    if model is None:
        model, tokenizer = clip_model.load()
    with torch.no_grad():
        emb = torch.nn.functional.normalize(torch.jit.load(str(DECODER))(torch.tensor(centroids_latent, dtype=torch.float32)), dim=-1)
    t = clip_model.embed_text(model, tokenizer, [text] + NEGATIVES)
    sims = (emb @ t.T).numpy()
    return 1 / (1 + np.exp(-10 * (sims[:, 0] - sims[:, 1:].max(1)))), sims[:, 0]


def select(relevancy, z_min):
    """-> z-score per cluster, and the ids of the clusters at least z_min above the mean, best first."""
    z = (relevancy - relevancy.mean()) / relevancy.std()
    return z, np.array([c for c in np.argsort(-z) if z[c] >= z_min], int)


def z_colours(z, z_min):
    """Red at the threshold up to yellow at z = 3, BGR."""
    green = np.clip((z - z_min) / max(3.0 - z_min, 1e-6), 0, 1) * 255
    return np.stack([np.zeros_like(green), green, np.full_like(green, 255)], 1).astype(np.uint8)


def pick_photos(images, xyz_selected, count):
    """The photos with the most highlighted Gaussians in frame (no occlusion test: this only chooses photos)."""
    scores = {}
    for im in images:
        w, h, fx, fy, cx, cy = im["cam"]
        pc = xyz_selected @ im["R"].T + im["t"]
        z = pc[:, 2]
        with np.errstate(invalid="ignore", divide="ignore"):
            u, v = fx * pc[:, 0] / z + cx, fy * pc[:, 1] / z + cy
            scores[im["name"]] = int(((z > 0.05) & (z < MAX_RANGE_M) & (u >= 0) & (u < w) & (v >= 0) & (v < h)).sum())
    exposure = lambda name: (name.split("_")[0], name.split("_")[3])     # stop and timestamp: skips stereo twins and tiles
    out, used = [], {exposure(n) for n in FIXED_PHOTOS}
    for name in sorted(scores, key=scores.get, reverse=True):
        if exposure(name) not in used and len(out) < count and scores[name]:
            out.append(name)
            used.add(exposure(name))
    return out


def photo_row(scene, im, g, radius, occluder, rank_of, colours):
    idx, uv, depth = observe(im, g["xyz"], radius, occluder)
    hit = rank_of[idx] >= 0
    order = np.flatnonzero(hit)[np.argsort(-depth[hit])]
    photo = cv2.imread(str(scene / "images" / im["name"]))
    canvas = (cv2.cvtColor(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR) * 0.7).astype(np.uint8)
    dot = max(2, round(im["cam"][0] / PANEL_W * 1.5))
    for (u, v), c in zip(uv[order].astype(int), colours[rank_of[idx[order]]].tolist()):
        cv2.circle(canvas, (u, v), dot, c, -1)
    both = cv2.resize(np.hstack([photo, canvas]), (2 * PANEL_W, round(photo.shape[0] * PANEL_W / photo.shape[1])), interpolation=cv2.INTER_AREA)
    cv2.putText(both, f"{im['name']}: {len(order)} of {len(idx)} visible Gaussians highlighted", (8, both.shape[0] - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)
    return both


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("text")
    ap.add_argument("--ply", default="runs/cheyava-site-v4/ply/point_cloud_29999.ply")
    ap.add_argument("--scene", default="data/colmap/cheyava_site_v4")
    ap.add_argument("--z", type=float, default=1.0, help="keep clusters this many standard deviations above the mean relevancy")
    args = ap.parse_args()
    stem, scene = args.ply[: -len(".ply")], Path(args.scene)
    clusters = json.loads(Path(stem + ".clusters.json").read_text())
    cluster = np.load(stem + ".visual.npz")["cluster"]
    relevancy, cosine = rank_clusters(args.text, clusters["centroids_latent"])
    z, best = select(relevancy, args.z)
    sizes = np.bincount(cluster[cluster < clusters["k"]], minlength=clusters["k"])
    print(f'"{args.text}": {len(best)} of {clusters["k"]} clusters at z >= {args.z:g} ({sizes[best].sum()} Gaussians, '
          f"{sizes[best].sum() / max(sizes.sum(), 1):.1%} of those with a cluster); {(relevancy > 0.5).sum()} have relevancy above 0.5; "
          f"cosine to the text over all clusters: min {cosine.min():.3f}, median {np.median(cosine):.3f}, max {cosine.max():.3f}")
    for r, c in enumerate(best[:8]):
        print(f"  {r + 1:2d}. cluster {c:3d}  z {z[c]:.2f}  relevancy {relevancy[c]:.3f}  cosine {cosine[c]:.3f}  {sizes[c]} Gaussians")

    rank_of = np.full(clusters["k"] + 1, -1)
    rank_of[best] = np.arange(len(best))
    rank_of = rank_of[np.minimum(cluster, clusters["k"])]          # per Gaussian: rank of its cluster, or -1
    colours = z_colours(z[best], args.z)
    g = load_ply(args.ply)
    order = window(g, TOPDOWN_M)
    order = np.concatenate([order[rank_of[order] < 0], order[rank_of[order] >= 0]])   # highlighted dots on top
    shade = np.where((rank_of[order] >= 0)[:, None], colours[rank_of[order]], (splat_colours(g, order) * 0.35).astype(np.uint8))
    rows = [np.hstack([panel(g["xyz"][order], splat_colours(g, order), TOPDOWN_M, TOPDOWN_RES, "splat colour"),
                       panel(g["xyz"][order], shade, TOPDOWN_M, TOPDOWN_RES, f'"{args.text}": {len(best)} clusters, z >= {args.z:g}')])]
    rows[0] = cv2.resize(rows[0], (2 * PANEL_W, PANEL_W), interpolation=cv2.INTER_AREA)
    images = {im["name"]: im for im in load_colmap(scene)[0]}
    occluder = g["opacity"] >= np.log(OCCLUDER_OPACITY / (1 - OCCLUDER_OPACITY))
    radius = np.exp(g["scale"].max(1))
    photos = [n for n in FIXED_PHOTOS if n in images] + pick_photos(list(images.values()), g["xyz"][rank_of >= 0], 2)
    rows += [photo_row(scene, images[n], g, radius, occluder, rank_of, colours) for n in photos]
    out = Path("runs/semantic/queries") / (re.sub(r"[^a-z0-9]+", "_", args.text.lower()).strip("_") + ".jpg")
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(f"{int((rank_of >= 0).sum())} Gaussians highlighted -> {out}")


if __name__ == "__main__":
    main()
