"""Runs on the Colab VM: render a trained splat from viewpoints no camera ever had.

  python3 vm_render.py <point_cloud.ply> <out.jpg>

Held-out photos sit a few centimetres from training photos, so they flatter the splat.
What a viewer user does is orbit, drop low, and look straight down. This renders those
views onto one sheet, so the splat is judged by looking at it. Training frame: east-north-up
metres. Labels give the view; the first row is a control from where the rover really stood.
"""
import sys

import cv2
import numpy as np
import torch
from gsplat.rendering import rasterization

HERO = np.array([0.69, 1.88, 0.47])                      # the Cheyava Falls rock
STOPS = {"s55d0": [0.0, 0.0, 0.0], "s56d0": [3.24, 2.47, 0.68], "s55d144": [-0.03, 9.16, 1.98]}
W, H, FOV_DEG = 960, 640, 60.0


def load_ply(path):
    """Standard 3DGS PLY -> means, quats, scales, opacities, SH coefficients [N, K, 3]."""
    with open(path, "rb") as f:
        names = []
        while True:
            line = f.readline().decode().strip()
            if line.startswith("element vertex"):
                n = int(line.split()[-1])
            elif line.startswith("property"):
                names.append(line.split()[-1])
            elif line == "end_header":
                break
        data = np.fromfile(f, dtype=np.float32, count=n * len(names)).reshape(n, len(names))
    col = {name: i for i, name in enumerate(names)}
    pick = lambda prefix: data[:, [col[k] for k in sorted((k for k in names if k.startswith(prefix)), key=lambda k: int(k.split("_")[-1]))]]
    dc, rest = pick("f_dc_"), pick("f_rest_")
    sh = np.concatenate([dc[:, None, :], rest.reshape(n, 3, -1).transpose(0, 2, 1)], 1)   # PLY stores the rest channel-major
    return data[:, [col["x"], col["y"], col["z"]]], pick("rot_"), np.exp(pick("scale_")), 1 / (1 + np.exp(-data[:, col["opacity"]])), sh


def look_at(eye, target, up=(0, 0, 1)):
    """World-to-camera 4x4, OpenCV axes (+Z forward, +Y down)."""
    z = np.asarray(target, float) - eye
    z /= np.linalg.norm(z)
    x = np.cross(z, up)
    x /= np.linalg.norm(x)
    R = np.stack([x, np.cross(z, x), z])
    M = np.eye(4)
    M[:3, :3], M[:3, 3] = R, -R @ eye
    return M


def views():
    out = []
    for name, p in STOPS.items():   # control: mast height at each stop, looking at the rock
        out.append((f"control: from {name} mast", look_at(np.array(p) + [0, 0, 2.0], HERO)))
    for az in range(0, 360, 60):    # orbit the rock at head height
        a = np.radians(az)
        out.append((f"orbit 4 m, 1.6 m up, from az {az}", look_at(HERO + [4 * np.sin(a), 4 * np.cos(a), 1.6], HERO)))
    for az in range(30, 360, 120):  # low, close
        a = np.radians(az)
        out.append((f"low 2.2 m, 0.5 m up, from az {az}", look_at(HERO + [2.2 * np.sin(a), 2.2 * np.cos(a), 0.5], HERO)))
    out.append(("top-down from 12 m", look_at(HERO + [0, 0, 12.0], HERO, up=(0, 1, 0))))
    out.append(("top-down from 30 m", look_at(HERO + [0, 0, 30.0], HERO, up=(0, 1, 0))))
    out.append(("standing between the stops, looking north", look_at(np.array([1.5, 5.0, 2.6]), [1.5, 15.0, 1.0])))
    return out


def main(ply, out_path):
    dev = "cuda"
    means, quats, scales, opac, sh = (torch.tensor(a, dtype=torch.float32, device=dev) for a in load_ply(ply))
    f = 0.5 * W / np.tan(np.radians(FOV_DEG) / 2)
    K = torch.tensor([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]], dtype=torch.float32, device=dev)[None]
    tiles = []
    for label, M in views():
        with torch.no_grad():
            img, alpha, _ = rasterization(means, quats, scales, opac, sh, torch.tensor(M, dtype=torch.float32, device=dev)[None], K, W, H,
                                          sh_degree=int(np.sqrt(sh.shape[1])) - 1, rasterize_mode="antialiased")
        bgr = (img[0].clamp(0, 1).cpu().numpy()[..., ::-1] * 255).astype(np.uint8).copy()
        cover = float((alpha[0] > 0.5).float().mean())
        cv2.putText(bgr, f"{label}  (covered {cover:.0%})", (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        tiles.append(bgr)
    tiles += [np.zeros_like(tiles[0])] * (-len(tiles) % 3)
    cv2.imwrite(out_path, np.vstack([np.hstack(tiles[i:i + 3]) for i in range(0, len(tiles), 3)]), [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f"{len(means)} Gaussians, {len(views())} views -> {out_path}")


if __name__ == "__main__":
    # self-check: looking north from the origin, east is to the right and up is up
    _M = look_at(np.zeros(3), [0, 1, 0])
    assert np.allclose(_M[:3, :3] @ [1, 0, 0], [1, 0, 0]) and np.allclose(_M[:3, :3] @ [0, 0, 1], [0, -1, 0])
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
