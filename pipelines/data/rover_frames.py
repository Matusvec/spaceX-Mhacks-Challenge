"""One rover stop -> clean pinhole frames in the rover frame.

Navcam tiles of one exposure are stitched back into the sensor frame, every frame is
resampled to a true pinhole (cahvore.py) and carries a coarse mask of what may train.
The gsplat COLMAP loader has no per-image masks, so the dataset is written as rectangular
crops of the good area. A cropped pinhole is still a pinhole.
"""
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation

import cahvore
from cahv_to_colmap import color_frame, ground_hit, sharpness

NAV_SCALE = 0.5        # Navcam output scale against the delivered tiles; Mastcam-Z carries the detail
G = 8                  # coarse cell, pixels: masks live on this grid
BLUR_FRAME_FRAC = 0.35  # a close-up with less than this share of the stop's median detail is out of focus all over
MCZ_MAX_RANGE_M = 30.0  # Mastcam-Z frames aimed at ground farther than this (or at the sky) add nothing near the rock
MCZ_CLOSE_M = 5.5
WORKSPACE_MIN_X_M = 0.8  # close-up frames aimed behind this (rover frame, +X forward) are the deck and its calibration target
MCZ_NEAR_M = 1.8        # nearest ground a Mastcam-Z frame can show from the mast
TILE_TRIM = 3          # px dropped from a Navcam tile edge that has a neighbour
MIN_CROP_PX = 240      # shortest side of a crop worth training on
BLUR_FRAC = 0.35       # Mastcam-Z: a cell this far below the frame's median local contrast is out-of-focus arm


@dataclass
class Frame:
    name: str            # file stem in the dataset
    stop: str
    kind: str            # "nav" or "mcz"
    eye: str             # "L" or "R"
    pair: tuple          # shared by the two eyes of one exposure
    K: np.ndarray
    R: np.ndarray        # rover -> camera
    C: np.ndarray        # camera centre, rover frame
    image: np.ndarray    # BGR, undistorted, uncropped
    good: np.ndarray     # bool per G x G cell: trainable (source coverage here; build_scene.py narrows it to ground)
    hires: np.ndarray = None   # same view at `up` times the resolution: what gets written. Stereo and masks use `image`
    up: int = 1
    dense: bool = True   # ground mask comes from dense stereo with the other eye (build_scene.confirm_ground)
    near: float = 0.9    # m, nearest range that stereo has to reach (sets the disparity search)

    @property
    def size(self):
        return self.image.shape[1], self.image.shape[0]

    def project(self, P):
        """Rover-frame points -> pixels, depth."""
        pc = (P - self.C) @ self.R.T
        z = np.where(pc[:, 2] > 1e-6, pc[:, 2], np.nan)
        return np.stack([self.K[0, 0] * pc[:, 0] / z + self.K[0, 2], self.K[1, 1] * pc[:, 1] / z + self.K[1, 2]], 1), pc[:, 2]


def rover_to_level(rec):
    """Rover nav frame -> local-level NED at this stop: rotation and position in the site frame."""
    w, x, y, z = (float(v) for v in rec["attitude"].strip("()").split(","))
    return Rotation.from_quat([x, y, z, w]).as_matrix(), np.array([float(v) for v in rec["extended"]["xyz"].strip("()").split(",")])


def largest_rect(good):
    """Largest all-True axis-aligned rectangle in a bool grid -> x0, y0, x1, y1 (exclusive)."""
    h, w = good.shape
    heights, best = np.zeros(w, int), (0, 0, 0, 0, 0)
    for y in range(h):
        heights = np.where(good[y], heights + 1, 0)
        stack = []
        for x in range(w + 1):
            cur, start = (heights[x] if x < w else 0), x
            while stack and stack[-1][1] >= cur:
                start, sh = stack.pop()
                if sh * (x - start) > best[0]:
                    best = (sh * (x - start), start, y - sh + 1, x, y + 1)
            stack.append((start, cur))
    return best[1:]


def undistort(model, src, scale, g=G):
    """Distorted source + its model -> pinhole K, R, image, and which coarse cells the source covers."""
    (fx, fy, _, _), R, _ = cahvore.pinhole(model)
    f = (fx + fy) / 2 * scale
    sh, sw = src.shape[:2]
    # Probe a wide coarse grid of the pinhole plane to find what the source covers, then
    # interpolate the same grid into the per-pixel remap (the mapping is smooth).
    half = min(2.2 * f, 1.8 * max(sw, sh) * scale)   # far outside the lens the distortion polynomial folds back
    span = np.arange(-half, half, g)
    u, v = np.meshgrid(span, span)
    rays = np.stack([u.ravel() / f, v.ravel() / f, np.ones(u.size)], 1)
    s = cahvore.project(model, model.C + 5.0 * rays @ R).reshape(*u.shape, 2).astype(np.float32)
    inside = (s[..., 0] >= 1) & (s[..., 0] < sw - 2) & (s[..., 1] >= 1) & (s[..., 1] < sh - 2)
    ys, xs = np.nonzero(inside)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = (x1 - x0) * g, (y1 - y0) * g
    gu, gv = np.meshgrid((np.arange(w) / g + x0).astype(np.float32), (np.arange(h) / g + y0).astype(np.float32))
    mx, my = (cv2.remap(np.ascontiguousarray(s[..., i]), gu, gv, cv2.INTER_LINEAR) for i in (0, 1))
    K = np.array([[f, 0, -span[x0]], [0, f, -span[y0]], [0, 0, 1]])
    image = cv2.remap(src, mx, my, cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    # a cell counts as covered only if its neighbours are: the source edge runs through border cells
    return K, R, image, cv2.erode(inside[y0:y1, x0:x1].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0


def detail(image):
    """Median edge strength at quarter resolution: about 15 on focused ground, under 3 on a blurred close-up."""
    g = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32), None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    return float(np.median(np.abs(cv2.Laplacian(g, cv2.CV_32F))))


def looks_at_ground(rec):
    """Boresight meets the ground within range, and not on the rover itself."""
    m = cahvore.parse(rec)
    hit = ground_hit(m.C, m.A)
    return hit is not None and hit[2] < MCZ_MAX_RANGE_M and not (abs(hit[0]) < 2.0 and abs(hit[1]) < 1.6)


def in_focus(image, shape):
    """Mastcam-Z is focused on the ground; the arm in the foreground is a blur. Sharp cells only.

    Blur is judged by local contrast over a 65 px window, not by a pixel-level Laplacian:
    sensor noise keeps the Laplacian high on a blurred arm. The arm always enters from the
    frame edge. A smooth patch inside the frame (the drill hole, a shadow) is ground and stays.
    """
    g = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    std = np.sqrt(np.maximum(cv2.blur(g ** 2, (65, 65)) - cv2.blur(g, (65, 65)) ** 2, 0))
    contrast = cv2.resize(std, shape[::-1], interpolation=cv2.INTER_AREA)
    blurred = cv2.dilate((contrast < BLUR_FRAC * np.median(contrast)).astype(np.uint8), np.ones((5, 5), np.uint8))
    n, labels = cv2.connectedComponents(blurred)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    return ~np.isin(labels, edge[edge > 0])


def crops(good, g=G, most=5):
    """Greedy cover of the good cells by rectangles -> pixel boxes (x0, y0, x1, y1).

    Hardware usually cuts a frame diagonally; one rectangle would throw away half the ground.
    """
    good, out = good.copy(), []
    for _ in range(most):
        x0, y0, x1, y1 = largest_rect(good)
        if (x1 - x0) * g < MIN_CROP_PX or (y1 - y0) * g < MIN_CROP_PX:
            break
        out.append((x0 * g, y0 * g, x1 * g, y1 * g))
        good[y0:y1, x0:x1] = False
    return out


def ints(s):
    return [int(float(v)) for v in s.strip("()").split(",")]


def navcam_exposures(recs, raw):
    """Group Navcam tiles by exposure and stitch each into one image with one camera model."""
    groups = defaultdict(list)
    for r in recs:
        iid = r["imageid"]
        if iid[:3] in ("NLF", "NRF") and "ECM" in iid:
            sol, sclk, _, seq = iid.split("_")[1:5]
            groups[(iid[1], sol, sclk, seq[-9:])].append(r)
    for (eye, sol, sclk, seq), tiles in sorted(groups.items()):
        sf = float(tiles[0]["extended"]["scaleFactor"])
        rects = [ints(t["extended"]["subframeRect"]) for t in tiles]
        ox = [round((x - min(r[0] for r in rects)) / sf) for x, *_ in rects]
        oy = [round((y - min(r[1] for r in rects)) / sf) for _, y, *_ in rects]
        dims = [ints(t["extended"]["dimension"]) for t in tiles]
        canvas = np.zeros((max(o + d[1] for o, d in zip(oy, dims)), max(o + d[0] for o, d in zip(ox, dims)), 3), np.uint8)
        filled = np.zeros(canvas.shape[:2], bool)
        for t, x, y, (w, h) in zip(tiles, ox, oy, dims):
            tile = cv2.imread(str(raw / f"{t['imageid']}.png"))
            # Tiles overlap by 8-16 px and their outermost pixels are off (a visible seam at full
            # resolution): where a tile has a neighbour, drop its edge and let the neighbour show.
            l, u = TILE_TRIM * (x > 0), TILE_TRIM * (y > 0)
            r, d = TILE_TRIM * (x + w < canvas.shape[1]), TILE_TRIM * (y + h < canvas.shape[0])
            canvas[y + u:y + h - d, x + l:x + w - r] = tile[u:h - d, l:w - r]
            filled[y + u:y + h - d, x + l:x + w - r] = True
        if not filled.all():
            continue   # a tile is missing from the feed; a holed canvas has no clean rectangle logic
        model = cahvore.parse(tiles[0]).shifted(ox[0], oy[0])
        yield eye, (sol, sclk, seq), tiles[0], model, canvas


def load_stop(raw, navcam_sols=None, mcz=True):
    """All usable frames of one stop. navcam_sols: keep only those sols (the arm is stowed on arrival)."""
    raw = Path(raw)
    stop = raw.name.split("_")[-1]
    recs = [json.loads(p.read_text()) for p in sorted(raw.glob("*.json"))]
    frames = []
    for eye, key, rec, model, canvas in navcam_exposures(recs, raw):
        if navcam_sols and int(key[0]) not in navcam_sols:
            continue
        K, R, image, inside = undistort(model, canvas, NAV_SCALE)
        F = Frame(f"{stop}_nav{eye}_{key[0]}_{key[1]}", stop, "nav", eye, (stop, "nav", *key), K, R, model.C, image, inside)
        if float(rec["extended"]["scaleFactor"]) == 2:
            # Pans arrive already halved on board. Stereo runs at NAV_SCALE, but the splat should
            # see every delivered pixel: same cells, twice the pixels per cell.
            F.hires, F.up = undistort(model, canvas, NAV_SCALE * 2, g=G * 2)[2], 2
            assert F.hires.shape[0] == 2 * image.shape[0] and F.hires.shape[1] == 2 * image.shape[1]
        frames.append(F)
    if mcz:
        # A shot is both eyes of one aim (same sol and sclk in the id). The same aim repeats
        # across sols: keep one shot per aim and zoom, a stereo pair over a single eye, then the sharpest.
        shots, aims = defaultdict(list), defaultdict(list)
        for r in recs:
            if r["camera"]["instrument"].startswith("MCZ") and color_frame(r) and looks_at_ground(r):
                shots[r["imageid"][4:19]].append(r)
        for shot in shots.values():
            ext, m = shot[0]["extended"], cahvore.parse(shot[0])
            aims[(round(float(ext["mastAz"])), round(float(ext["mastEl"])), round(cahvore.pinhole(m)[0][0] / 1000))].append(shot)
        for group in aims.values():
            best = max(group, key=lambda shot: (len(shot), sharpness(raw / f"{shot[0]['imageid']}.png")))
            for rec in best:
                iid, model = rec["imageid"], cahvore.parse(rec)
                K, R, image, inside = undistort(model, cv2.imread(str(raw / f"{iid}.png")), 1.0)
                rng = ground_hit(model.C, model.A)[2]
                # At 110 mm on the workspace the two eyes are over a thousand pixels apart: no dense
                # stereo, so the only mask is focus. Wider or farther frames go the Navcam way.
                dense = not (K[0, 0] >= 10000 and rng < MCZ_CLOSE_M)
                if not dense and ground_hit(model.C, model.A)[0] < WORKSPACE_MIN_X_M:
                    continue   # focus cannot tell sharp rover hardware from rock: only the workspace ahead is safe
                frames.append(Frame(f"{stop}_mcz{iid[1]}_{iid[4:8]}_{iid[9:19]}", stop, "mcz", iid[1], (stop, "mcz", iid[4:19]),
                                    K, R, model.C, image, inside if dense else inside & in_focus(image, inside.shape),
                                    dense=dense, near=max(MCZ_NEAR_M, 0.6 * rng)))
    # A close-up that is blurred all over is the drill or the arm held in front of the camera:
    # the edge-blur mask cannot flag it, because nothing in the frame is sharp to compare with.
    close = [F for F in frames if not F.dense]
    if close:
        floor = BLUR_FRAME_FRAC * np.median([detail(F.image) for F in close])
        frames = [F for F in frames if F.dense or detail(F.image) >= floor]
    return recs[0], frames


if __name__ == "__main__":
    g = np.zeros((6, 8), bool)
    g[1:5, 2:7] = True
    g[2, 3] = False
    assert largest_rect(g) == (4, 1, 7, 5), largest_rect(g)
    assert crops(np.ones((100, 100), bool)) == [(0, 0, 800, 800)]
    print("ok")
