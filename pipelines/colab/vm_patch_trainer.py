"""Runs on the Colab VM: make a private, patched copy of gsplat's example trainer.

  python3 vm_patch_trainer.py /content/gsplat/examples/simple_trainer.py /content/pss_site/site_trainer.py

The shared gsplat checkout is never edited. Each patch names the exact upstream text it
replaces and fails loudly if upstream has changed. Knobs are environment variables so one
copy serves every experiment.

1. Depth floor. gsplat's depth loss is 1/depth with no floor: one uncovered pixel (depth 0)
   gives a NaN gradient and the run dies at the first MCMC relocation. PSS_DEPTH_FLOOR
   (metres, default 0.5): nothing in this scene is nearer than the rover's mast height.
2. Needle penalty. The cameras sit at three spots, so a Gaussian stretched along the line of
   sight looks perfect from every training view and like a spike from anywhere else. Penalise
   the longest axis being more than PSS_NEEDLE_RATIO (default 3) times the middle one. A flat
   disc (two long axes, one short) is what ground looks like and is not penalised.
   PSS_NEEDLE is the weight; 0 (default) turns it off.
"""
import sys

PATCHES = [
    (
        "depths, depths_gt, scene_scale=self.scene_scale",
        'depths.clamp(min=float(os.environ.get("PSS_DEPTH_FLOOR", "0.5"))), depths_gt, scene_scale=self.scene_scale',
    ),
    (
        '''            if cfg.scale_reg > 0.0:
                loss += cfg.scale_reg * scale_reg_loss(self.splats["scales"])
''',
        '''            if cfg.scale_reg > 0.0:
                loss += cfg.scale_reg * scale_reg_loss(self.splats["scales"])
            if float(os.environ.get("PSS_NEEDLE", "0")) > 0.0:
                _s = self.splats["scales"].sort(dim=-1).values   # log scales, ascending
                _over = _s[:, 2] - _s[:, 1] - math.log(float(os.environ.get("PSS_NEEDLE_RATIO", "3")))
                loss += float(os.environ["PSS_NEEDLE"]) * torch.relu(_over).mean()
''',
    ),
]


def patch(text):
    for old, new in PATCHES:
        assert text.count(old) == 1, f"upstream trainer changed; cannot place patch at: {old[:60]!r}"
        text = text.replace(old, new)
    return text


if __name__ == "__main__":
    assert patch("x = f(\n    depths, depths_gt, scene_scale=self.scene_scale\n)\n" + PATCHES[1][0]).count("PSS_") == 4
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src = open(sys.argv[1]).read()
    assert "import os" in src and "import math" in src
    open(sys.argv[2], "w").write(patch(src))
    print("patched trainer ->", sys.argv[2])
