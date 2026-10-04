"""The terrain-class network: SegFormer-B1 (ADE20K weights from Hugging Face) with a 4-class head."""
import torch
import torch.nn.functional as F
from transformers import SegformerForSemanticSegmentation

PRETRAINED = "nvidia/segformer-b1-finetuned-ade-512-512"
MEAN, STD = 0.449, 0.226   # ImageNet mean and std averaged over RGB; the grey image is repeated on 3 channels


def build(num_classes=4):
    return SegformerForSemanticSegmentation.from_pretrained(PRETRAINED, num_labels=num_classes, ignore_mismatched_sizes=True)


def load(checkpoint, device="cuda"):
    model = build()
    model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True)["model"])
    return model.to(device).eval()


def logits(model, gray, out_size=None):
    """gray: float [B, H, W] in 0..1. Returns logits [B, C, h, w]: at out_size if given, else the input size."""
    x = ((gray - MEAN) / STD).unsqueeze(1).expand(-1, 3, -1, -1)
    h, w = gray.shape[-2:]
    pad = (0, -w % 32, 0, -h % 32)             # SegFormer strides: 4, 8, 16, 32
    out = model(pixel_values=F.pad(x, pad, mode="replicate")).logits   # quarter resolution
    out = out[..., : (h + 3) // 4, : (w + 3) // 4]
    return F.interpolate(out, out_size or (h, w), mode="bilinear", align_corners=False)
