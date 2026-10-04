"""Text query over a scene's visual clusters (docs/contracts.md sections 4 and 10).

Same ranking as pipelines/semantic/query_clusters.py: embed the text with the CLIP that embedded the
image regions, decode the cluster centroids to that space, score each cluster against generic
negatives, and keep the clusters that stand out for this text in this scene.
"""

import json
import math
import threading

import settings

ARCH, PRETRAINED = "ViT-B-16", "laion2b_s34b_b88k"
ENCODER = f"open_clip {ARCH} ({PRETRAINED})"  # must equal clusters.json "encoder"
NEGATIVES = ["object", "things", "stuff", "texture"]
# A fixed relevancy threshold keeps nearly every cluster for one text and a handful for another,
# so clusters are kept when they are at least this many standard deviations above the scene's mean.
Z_MIN = 1.0

_lock = threading.Lock()
_clip = None  # (torch, model, tokenizer, decoder, negative embeddings), loaded on the first query


class QueryUnavailable(Exception):
    """The query stack cannot run here; the message says what is missing."""


def _load():
    global _clip
    with _lock:
        if _clip is None:
            try:
                import open_clip
                import torch
            except ImportError as err:
                raise QueryUnavailable(f"text query needs apps/backend/requirements-query.txt ({err})") from err
            if not settings.AE_DECODER_PATH.is_file():
                raise QueryUnavailable(f"cluster decoder not found at {settings.AE_DECODER_PATH}; set AE_DECODER_PATH")
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model = open_clip.create_model(ARCH, pretrained=PRETRAINED).to(device).eval()
            tokenizer = open_clip.get_tokenizer(ARCH)
            decoder = torch.jit.load(str(settings.AE_DECODER_PATH), map_location=device).eval()
            _clip = (torch, model, tokenizer, decoder, None)
            _clip = (torch, model, tokenizer, decoder, _embed(NEGATIVES))
    return _clip


def _embed(texts):
    torch, model, tokenizer, _, _ = _clip
    device = next(model.parameters()).device
    with torch.no_grad():
        return torch.nn.functional.normalize(model.encode_text(tokenizer(texts).to(device)).float(), dim=-1)


def query_scene(scene_id: str, text: str) -> dict:
    """-> {"cluster_ids": best first, "explanation": str}. Raises FileNotFoundError or QueryUnavailable."""
    scene_dir = (settings.SCENES_DIR / scene_id).resolve()
    if scene_dir.parent != settings.SCENES_DIR:  # scene_id comes from the browser: one folder name only
        raise FileNotFoundError(scene_id)
    manifest = json.loads((scene_dir / "scene.json").read_text())
    if not manifest.get("clusters"):
        raise FileNotFoundError(f"scene {scene_id} has no clusters")
    clusters = json.loads((scene_dir / manifest["clusters"]).read_text())
    if clusters.get("encoder") != ENCODER:
        raise QueryUnavailable(f"clusters were embedded with {clusters.get('encoder')}, this backend has {ENCODER}")

    torch, model, _, decoder, negatives = _load()
    device = next(model.parameters()).device
    with torch.no_grad():
        centroids = torch.tensor(clusters["centroids_latent"], dtype=torch.float32, device=device)
        embedded = torch.nn.functional.normalize(decoder(centroids), dim=-1)
        to_text = (embedded @ _embed([text]).T)[:, 0]
        to_negative = (embedded @ negatives.T).max(dim=1).values
        relevancy = torch.sigmoid(10 * (to_text - to_negative)).cpu().tolist()

    mean = sum(relevancy) / len(relevancy)
    std = math.sqrt(sum((r - mean) ** 2 for r in relevancy) / len(relevancy))
    z = [(r - mean) / std if std > 0 else 0.0 for r in relevancy]
    cluster_ids = sorted((c for c in range(len(z)) if z[c] >= Z_MIN), key=lambda c: -z[c])
    return {
        "cluster_ids": cluster_ids,
        "explanation": f"visual: '{text}': {len(cluster_ids)} of {len(z)} look-alike clusters stand out for this text "
        f"(relevancy at least {Z_MIN:g} standard deviation above this scene's mean)",
    }
