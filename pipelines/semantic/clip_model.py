"""The one CLIP used for image regions and for text queries. The backend must use the same model for text."""
import cv2
import numpy as np
import open_clip
import torch

ARCH, PRETRAINED = "ViT-B-16", "laion2b_s34b_b88k"   # Hugging Face: laion/CLIP-ViT-B-16-laion2B-s34B-b88K
ENCODER = f"open_clip {ARCH} ({PRETRAINED})"
EMBED_DIM, INPUT_PX = 512, 224


def load(device="cuda"):
    model = open_clip.create_model(ARCH, pretrained=PRETRAINED).to(device).eval()
    return model, open_clip.get_tokenizer(ARCH)


@torch.no_grad()
def embed_text(model, tokenizer, texts, device="cuda"):
    """-> unit vectors [len(texts), 512], float32, on the CPU."""
    e = model.encode_text(tokenizer(texts).to(device)).float()
    return torch.nn.functional.normalize(e, dim=-1).cpu()


@torch.no_grad()
def embed_crops(model, crops, device="cuda", batch=128):
    """crops: list of RGB uint8 arrays of any size (squared by padding with black). -> unit vectors [n, 512]."""
    mean = torch.tensor(model.visual.image_mean, device=device).view(1, 3, 1, 1)
    std = torch.tensor(model.visual.image_std, device=device).view(1, 3, 1, 1)
    out = []
    for i in range(0, len(crops), batch):
        x = np.stack([square(c) for c in crops[i:i + batch]])
        x = torch.from_numpy(x).to(device).permute(0, 3, 1, 2).float() / 255
        with torch.autocast("cuda", dtype=torch.float16):
            e = model.encode_image((x - mean) / std)
        out.append(torch.nn.functional.normalize(e.float(), dim=-1).cpu())
    return torch.cat(out) if out else torch.zeros(0, EMBED_DIM)


def square(crop):
    """Pad the short side with black, then resize to the model's input."""
    h, w = crop.shape[:2]
    n = max(h, w)
    top, left = (n - h) // 2, (n - w) // 2
    crop = cv2.copyMakeBorder(crop, top, n - h - top, left, n - w - left, cv2.BORDER_CONSTANT, value=0)
    return cv2.resize(crop, (INPUT_PX, INPUT_PX), interpolation=cv2.INTER_AREA if n > INPUT_PX else cv2.INTER_CUBIC)
