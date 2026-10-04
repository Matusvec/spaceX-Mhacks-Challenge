"""Make the photos agree on brightness and colour before training.

The frames come from two cameras (Navcam renders this sand greenish, Mastcam-Z orange),
several sols and many exposures. A splat trained on them as they are shows a patch of one
colour inside a field of another. The trainer can absorb this with a per-image colour grid,
but then nothing pins the splat's own colours and whole regions drift.

So solve it here, the way panorama stitchers do: every frame gets one gain per channel, and
every ground point one true colour, such that frame gain x true colour matches what each
frame recorded there. Mastcam-Z is the reference (its gains average to 1). Medians, not
means: the same ground was photographed under different shadows. By default only the
camera-to-camera part of the answer is applied (see PER_FRAME).
"""
import cv2
import numpy as np

import stereo

MCZ_BLUR_PX = 12      # a Navcam pixel covers about 30 Mastcam-Z pixels: compare like with like
NAV_BLUR_PX = 2
POINTS_PER_STOP = 20000
# False: one white-balance gain for all Navcam frames, Mastcam-Z untouched, and the trainer's
# per-image colour grid absorbs what is left. True: every frame gets its own gain and the grid
# is switched off. Tried both (runs cheyava-site-v2 and -v3): with True, frame-shaped dark and
# light patches show on the ground, because one gain cannot fix vignetting. So False.
PER_FRAME = False
ROUNDS = 12


def samples(F, local):
    """Blurred BGR colour the frame shows at each rover-frame point; NaN where it does not see ground there."""
    out = np.full((len(local), 3), np.nan, np.float32)
    uv, z = F.project(local)
    ok = stereo.on_good(F, uv, z)
    soft = cv2.GaussianBlur(F.image, (0, 0), MCZ_BLUR_PX if F.kind == "mcz" else NAV_BLUR_PX)
    c = soft[uv[ok, 1].astype(int), uv[ok, 0].astype(int)].astype(np.float32)
    c[(c.max(1) > 250) | (c.min(1) < 8)] = np.nan      # clipped or black pixels say nothing about gain
    out[ok] = c
    return out


def exposure_gains(stops):
    """{frame name: BGR gain to divide the frame by}, and a short report.

    `stops`: dicts with frames, W (world points), A and b (rover-to-world). Points from every
    stop are looked up in every frame, so the stops are tied to each other, not only to themselves.
    """
    rng = np.random.default_rng(0)
    world = np.concatenate([s["W"][rng.choice(len(s["W"]), min(POINTS_PER_STOP, len(s["W"])), replace=False)] for s in stops.values()])
    frames = [(s, F) for s in stops.values() for F in s["frames"]]
    with np.errstate(invalid="ignore", divide="ignore"):
        logc = np.log(np.stack([samples(F, (world - s["b"]) @ s["A"]) for s, F in frames]))   # frames x points x 3
    mcz = np.array([F.kind == "mcz" for _, F in frames])
    g = np.zeros((len(frames), 3), np.float32)
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")            # all-NaN slices: points or frames with no overlap
            for _ in range(ROUNDS):
                true = np.nanmedian(logc - g[:, None], axis=0)
                g = np.nan_to_num(np.nanmedian(logc - true[None], axis=1))
                g -= g[mcz].mean(0)
    shared = int((np.isfinite(logc[..., 0]).sum(0) >= 2).sum())
    gains = np.exp(g)
    if not PER_FRAME:
        gains[~mcz], gains[mcz] = np.median(gains[~mcz], 0), 1.0
    report = {"points_seen_by_2plus_frames": shared,
              "navcam_gain_bgr_median": np.median(gains[~mcz], 0).round(3).tolist(),
              "navcam_gain_range": [round(float(gains[~mcz].min()), 3), round(float(gains[~mcz].max()), 3)],
              "mastcamz_gain_range": [round(float(gains[mcz].min()), 3), round(float(gains[mcz].max()), 3)]}
    return {F.name: gains[i] for i, (_, F) in enumerate(frames)}, report


def apply_gain(image, gain):
    return np.clip(image.astype(np.float32) / gain, 0, 255).astype(np.uint8)


if __name__ == "__main__":
    # self-check on the solver alone: three "frames" see the same points at gains 1, 0.5, 2
    rng = np.random.default_rng(0)
    true = rng.uniform(40, 200, (500, 3))
    logc = np.log(np.stack([true * k for k in (1.0, 0.5, 2.0)])).astype(np.float32)
    g = np.zeros((3, 3), np.float32)
    for _ in range(ROUNDS):
        t = np.nanmedian(logc - g[:, None], axis=0)
        g = np.nanmedian(logc - t[None], axis=1)
        g -= g[:1].mean(0)
    assert np.allclose(np.exp(g)[:, 0], [1.0, 0.5, 2.0], atol=1e-3), np.exp(g)
    assert apply_gain(np.full((1, 1, 3), 100, np.uint8), np.array([0.5, 1, 2])).ravel().tolist() == [200, 100, 50]
    print("ok")
