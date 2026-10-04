#!/usr/bin/env python3
"""Several rover stops -> one COLMAP dataset gsplat can train on.

  python3 pipelines/data/build_scene.py data/raw data/colmap/cheyava_site
  python3 pipelines/data/check_scene.py data/colmap/cheyava_site

One stop is one viewpoint: the mast never moves more than half a metre. The rover parked
at three places within 10 m of the Cheyava Falls rock, so the stops together are what give
a splat real parallax. Per stop: undistort (cahvore.py), keep only stereo-confirmed ground
(rover_frames.py, stereo.py). Across stops: telemetry places them, height maps then image
texture line them up (register.py), and one gain per frame makes them agree on colour
(colour.py). Output is undistorted crops with known poses and a
metric point cloud, in one east-north-up frame. No SfM: poses come from the camera models.

Train at data factor 1 (crops are at most about 6 MP). <out>/frame.json describes the frame.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.spatial.transform import Rotation

import colour
import register
import stereo
from rover_frames import crops, load_stop, rover_to_level

# stop -> sol the rover arrived. Navcam is taken from that sol only: the arm is still stowed,
# and it moves between later sols. The first stop is the reference the others are laid onto.
STOPS = {"cheyava_s55d0": 1195, "cheyava_s56d0": 1210, "cheyava_s55d144": 1204}
# Site origins in site-55 north-east-down metres, from NASA's M20_waypoints.json
# (northing, easting, elev_geoid of site 56 drive 0 minus site 55 drive 0).
SITE_ORIGIN = {55: np.zeros(3), 56: np.array([1096432.795 - 1096430.337, 4346302.736 - 4346299.499, 2354.03125 - 2354.488037])}
WORLD_ORIGIN = {"site": 55, "drive": 0, "easting_m": 4346299.499, "northing_m": 1096430.337, "elev_geoid_m": -2354.488037,
                "lon_deg": 77.305133, "lat_deg": 18.497443, "source": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"}
NED_TO_ENU = np.array([[0., 1, 0], [1, 0, 0], [0, 0, -1]])
# Rover frame: +X forward, +Y right, +Z down, origin on the ground between the middle wheels.
# Measured from the stereo clouds: every point inside this footprint is the rover, except in
# the strip ahead of the front wheels, where only the stowed arm (well above ground) is.
ROVER_FOOTPRINT = (-2.9, 1.9, -1.5, 1.5)    # x0, x1, y0, y1
ARM_STRIP_X = 1.5                           # ahead of this, low points are ground (the hero rock at one stop)
ARM_MIN_HEIGHT = 0.45                       # m above the wheel plane
MIN_CELL_POINTS = 3                         # stereo points a coarse cell needs before it counts as ground
HOLE_CELLS = 150                            # unmatched patch up to this many cells (about 100 px square) is filled in
REGISTER_RANGE = 14.0                       # m. Navcam stereo is good to a few cm inside this
VOXELS = ((8.0, 0.06), (25.0, 0.2), (1e9, 1.0))   # (out to this range from the stop, one point per this many metres)
MCZ_VOXEL = 0.01                            # Mastcam-Z points sit on the hero rock: keep them dense
TEXTURE_POINTS = 60000
MIN_CROP_POINTS = 50
FILL_CELL, FILL_REACH, FILL_MIN_NEIGHBOURS = 0.1, 3, 12   # m; cells each way; measured cells needed in that window
FILL = False   # tried (dataset v5): fewer empty cells, but flat blank patches and more dark specks in the viewer, so off
FLIER_M, FLIER_PER_M = 0.3, 0.03             # a point further than this (+ per metre of range) from its cell's median height is a bad match


def confirm_ground(L, R):
    """Narrow both frames' masks to cells stereo measured as ground. Returns the ground points (rover frame).

    One rule covers rover hardware (measured inside the footprint), sky and far hills (no
    usable disparity), and anything only one eye sees.
    """
    P = stereo.dense_points(L, R, near=min(L.near, R.near))
    x0, x1, y0, y1 = ROVER_FOOTPRINT
    rover = (P[:, 0] > x0) & (P[:, 0] < x1) & (P[:, 1] > y0) & (P[:, 1] < y1) & ((P[:, 0] < ARM_STRIP_X) | (P[:, 2] < -ARM_MIN_HEIGHT))
    k = np.ones((5, 5), np.uint8)
    for F in (L, R):
        ground = stereo.cells(F, P[~rover]) >= MIN_CELL_POINTS
        hardware = cv2.dilate((stereo.cells(F, P[rover]) > 0).astype(np.uint8), k) > 0
        # Stereo leaves small holes on smooth sand and behind rocks. A small hole ringed by
        # ground is ground; anything bigger, or touching hardware, stays out.
        n, labels, stats, _ = cv2.connectedComponentsWithStats((~ground).astype(np.uint8), connectivity=4)
        small = np.isin(labels, [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] <= HOLE_CELLS])
        F.good &= (ground | small) & ~hardware
    return P[~rover]


def prepare(raw, sol):
    """One stop -> frames, Navcam ground cloud and Mastcam-Z points (rover frame), telemetry rover-to-world pose."""
    rec, frames = load_stop(raw, navcam_sols={sol})
    pairs = {}
    for F in frames:
        pairs.setdefault(F.pair, {})[F.eye] = F
    nav, mcz, kept = [], [np.zeros((0, 3))], []
    for p in pairs.values():
        both = len(p) == 2
        if both and p["L"].kind == "mcz":
            stereo.align_right(p["L"], p["R"])
        if both and p["L"].dense:
            nav.append(confirm_ground(p["L"], p["R"]))
        elif both:
            mcz.append(stereo.sparse_points(p["L"], p["R"]))
        if both or not next(iter(p.values())).dense:   # an unpaired frame on the dense path has no ground mask
            kept += p.values()
    level_R, xyz = rover_to_level(rec)
    nav, mcz = np.concatenate(nav), np.concatenate(mcz)
    keep = on_surface(np.concatenate([nav, mcz]))
    nav, mcz = nav[keep[:len(nav)]], mcz[keep[len(nav):]]
    return kept, nav, mcz, NED_TO_ENU @ level_R, NED_TO_ENU @ (xyz + SITE_ORIGIN[int(rec["site"])])


def on_surface(P):
    """Which rover-frame points sit on the local surface. A bad stereo match floats metres above or below it."""
    rng = np.linalg.norm(P[:, :2], axis=1)
    far = rng >= 20
    cell = np.where(far, 2.0, 0.25)   # stereo is sparse on the ground far out
    key = (np.floor(P[:, 0] / cell).astype(np.int64) * 100003 + np.floor(P[:, 1] / cell).astype(np.int64)) * 2 + far
    order = np.lexsort((P[:, 2], key))
    starts = np.r_[0, np.nonzero(np.diff(key[order]))[0] + 1]
    counts = np.diff(np.r_[starts, len(P)])
    median = np.repeat(P[order][starts + counts // 2, 2], counts)
    keep = np.zeros(len(P), bool)
    keep[order] = (np.abs(P[order, 2] - median) < FLIER_M + FLIER_PER_M * rng[order]) & (np.repeat(counts, counts) >= 4)
    return keep


def thin(P, size):
    return P[np.unique(np.floor(P / size).astype(np.int64), axis=0, return_index=True)[1]]


def decimate(P):
    """Rover-frame cloud -> one point per voxel, voxels growing with range from the rover."""
    rng, out, lo = np.linalg.norm(P[:, :2], axis=1), [], 0.0
    for hi, size in VOXELS:
        out.append(thin(P[(rng >= lo) & (rng < hi)], size))
        lo = hi
    return np.concatenate(out)


def fill_ground(stops):
    """World points for ground cells that stereo left empty but that sit inside measured ground.

    The trainer only makes new Gaussians by splitting ones it has, so a patch with no starting
    point stays a hole even where photos show it. Height is the mean of measured neighbours
    within FILL_REACH cells; a cell with too few measured neighbours is left alone, so this
    bridges gaps and never extends the edge. A fill point with no photo is dropped later.
    """
    W = np.concatenate([s["W"] for s in stops.values()])
    centres = np.array([s["b"][:2] for s in stops.values()])
    W = W[np.min(np.linalg.norm(W[:, None, :2] - centres[None], axis=2), 1) < REGISTER_RANGE]
    origin = W[:, :2].min(0)
    ij = ((W[:, :2] - origin) / FILL_CELL).astype(int)
    shape = tuple(ij.max(0) + 1)
    flat = ij[:, 0] * shape[1] + ij[:, 1]
    n = np.bincount(flat, minlength=shape[0] * shape[1]).reshape(shape).astype(np.float32)
    z = np.bincount(flat, weights=W[:, 2], minlength=shape[0] * shape[1]).reshape(shape).astype(np.float32) / np.maximum(n, 1)
    have, out = n > 0, []
    k = (2 * FILL_REACH + 1,) * 2
    for _ in range(2):   # the second pass bridges gaps twice as wide, from the first pass's fill
        near = cv2.blur(have.astype(np.float32), k) * k[0] * k[1]
        zmean = cv2.blur(np.where(have, z, 0), k) * k[0] * k[1] / np.maximum(near, 1)
        new = ~have & (near >= FILL_MIN_NEIGHBOURS)
        i, j = np.nonzero(new)
        out.append(np.c_[(i + 0.5) * FILL_CELL + origin[0], (j + 0.5) * FILL_CELL + origin[1], zmean[new]])
        z, have = np.where(new, zmean, z), have | new
    return np.concatenate(out)


def texture(F):
    """Grey with the local mean removed: rock and pebble texture, not lighting."""
    g = cv2.cvtColor(F.image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    return cv2.GaussianBlur(g, (0, 0), 1.5) - cv2.GaussianBlur(g, (0, 0), 8)


def sample(frames, tex, local):
    """Texture each rover-frame point shows in the first frame that sees it as ground. NaN if none does."""
    val = np.full(len(local), np.nan, np.float32)
    for F, T in zip(frames, tex):
        todo = np.nonzero(np.isnan(val))[0]
        uv, z = F.project(local[todo])
        ok = stereo.on_good(F, uv, z)
        x, y = np.clip(uv[ok, 0], 0, T.shape[1] - 1.001), np.clip(uv[ok, 1], 0, T.shape[0] - 1.001)
        i, j, fx, fy = x.astype(int), y.astype(int), x % 1, y % 1   # bilinear
        val[todo[ok]] = (T[j, i] * (1 - fx) + T[j, i + 1] * fx) * (1 - fy) + (T[j + 1, i] * (1 - fx) + T[j + 1, i + 1] * fx) * fy
    return val


def place(s, placed):
    """Lay a stop onto the stops already placed: height maps first, then image texture."""
    A, b = s["A"], s["b"]
    near = s["nav"][np.linalg.norm(s["nav"][:, :2], axis=1) < REGISTER_RANGE]
    ref = np.concatenate([p["W"] for p in placed])
    Rc, tc, report = register.align(ref[np.linalg.norm(ref[:, :2] - b[:2], axis=1) < 2 * REGISTER_RANGE], near @ A.T + b, b)
    A, b = Rc @ A, Rc @ b + tc

    # Texture: what the placed stops saw at each point should be what this stop sees there.
    val = np.concatenate([p["val"] for p in placed])
    pick = np.nonzero(np.isfinite(val) & (np.linalg.norm(ref[:, :2] - b[:2], axis=1) < REGISTER_RANGE))[0]
    pick = np.random.default_rng(0).choice(pick, min(TEXTURE_POINTS, len(pick)), replace=False)

    def score(x):
        A2, b2 = Rotation.from_rotvec(x[3:]).as_matrix() @ A, b + x[:3]
        v = sample(s["navf"], s["tex"], (ref[pick] - b2) @ A2)
        ok = np.isfinite(v)
        return float(np.corrcoef(val[pick][ok], v[ok])[0, 1]) if ok.sum() > 2000 else -1.0

    before = score(np.zeros(6))
    x, after = register.climb(score, [0.02, 0.02, 0.02, 0.003, 0.003, 0.003])
    report.update(texture_corr_before=round(before, 3), texture_corr_after=round(after, 3),
                  texture_shift_m=[round(float(v), 4) for v in x[:3]], texture_rotation_deg=round(float(np.degrees(np.linalg.norm(x[3:]))), 3))
    return Rotation.from_rotvec(x[3:]).as_matrix() @ A, b + x[:3], report


def main(raw_root, out):
    raw_root, out = Path(raw_root), Path(out)
    stops, report = {}, {}
    for name, sol in STOPS.items():
        frames, nav, mcz, A, b = prepare(raw_root / name, sol)
        s = dict(frames=frames, nav=nav, A=A, b=b, navf=[F for F in frames if F.kind == "nav"])
        s["tex"] = [texture(F) for F in s["navf"]]
        if stops:
            s["A"], s["b"], report[name] = place(s, list(stops.values()))
        local = np.concatenate([decimate(nav), thin(mcz, MCZ_VOXEL)])
        s.update(local=local, W=local @ s["A"].T + s["b"], val=sample(s["navf"], s["tex"], local))
        stops[name] = s
        print(f"{name}: {len(frames)} frames, {len(local)} points", json.dumps(report.get(name, "reference stop")))

    fill = fill_ground(stops) if FILL else np.zeros((0, 3))
    report["fill_points"] = len(fill)
    for s in stops.values():   # offered to every stop: each keeps the ones its own photos show
        s["local"] = np.concatenate([s["local"], (fill - s["b"]) @ s["A"]])
        s["W"] = np.concatenate([s["W"], fill])
    gains, report["exposure"] = colour.exposure_gains(stops)
    print("exposure", json.dumps(report["exposure"]))

    # ---- images: every good rectangle of every frame is its own pinhole image.
    # A point is only tied to images of its own stop: same viewpoint, so nothing hides it.
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "sparse/0").mkdir(parents=True, exist_ok=True)
    for stale in (out / "images").iterdir():
        stale.unlink()
    cams, imgs, pts, base = [], [], [], 0
    for s in stops.values():
        n = len(s["local"])
        tracks, rgb = [[] for _ in range(n)], np.zeros((n, 3), np.uint8)
        for F in s["frames"]:
            uv, z = F.project(s["local"])
            u = F.up
            pixels = colour.apply_gain(F.hires if F.hires is not None else F.image, gains[F.name])
            Rcw = F.R @ s["A"].T
            t = -Rcw @ (s["A"] @ F.C + s["b"])
            qx, qy, qz, qw = Rotation.from_matrix(Rcw).as_quat()
            for k, (x0, y0, x1, y1) in enumerate(crops(F.good)):
                with np.errstate(invalid="ignore"):
                    hit = np.nonzero((z > 0) & (uv[:, 0] >= x0) & (uv[:, 0] < x1 - 1) & (uv[:, 1] >= y0) & (uv[:, 1] < y1 - 1))[0]
                if len(hit) < MIN_CROP_POINTS:
                    continue   # the trainer's depth loss needs points in every image, and no points means no measured ground
                image_id, fname = len(imgs) + 1, f"{F.name}_{k}.jpg"
                cv2.imwrite(str(out / "images" / fname), pixels[y0 * u:y1 * u, x0 * u:x1 * u], [cv2.IMWRITE_JPEG_QUALITY, 92])
                for j, i in enumerate(hit):
                    if not tracks[i]:
                        rgb[i] = pixels[int(uv[i, 1] * u), int(uv[i, 0] * u), ::-1]
                    tracks[i].append((image_id, j))
                cams.append(f"{image_id} PINHOLE {(x1 - x0) * u} {(y1 - y0) * u} {F.K[0, 0] * u} {F.K[1, 1] * u} {(F.K[0, 2] - x0) * u} {(F.K[1, 2] - y0) * u}")
                imgs.append(f"{image_id} {qw} {qx} {qy} {qz} {t[0]} {t[1]} {t[2]} {image_id} {fname}\n"
                            + " ".join(f"{(uv[i, 0] - x0) * u:.2f} {(uv[i, 1] - y0) * u:.2f} {base + i + 1}" for i in hit))
        for i in range(n):
            if tracks[i]:
                x, y, z_ = s["W"][i]
                pts.append(f"{base + i + 1} {x:.5f} {y:.5f} {z_:.5f} {rgb[i, 0]} {rgb[i, 1]} {rgb[i, 2]} 0.5 " + " ".join(f"{a} {j}" for a, j in tracks[i]))
        base += n

    sparse = out / "sparse/0"
    (sparse / "cameras.txt").write_text("\n".join(cams) + "\n")
    (sparse / "images.txt").write_text("\n".join(imgs) + "\n")
    (sparse / "points3D.txt").write_text("\n".join(pts) + "\n")
    frame = {
        "world": "east-north-up, metres. Origin: rover position at site 55 drive 0, on the ground.",
        "origin": WORLD_ORIGIN,
        "poses": "Camera models from the raw-image records (CAHVOR/CAHVORE), undistorted to pinhole. Not from SfM.",
        "stops": {n: {"rover_to_world_R": s["A"].round(6).tolist(), "rover_position": s["b"].round(4).tolist(), "frames": len(s["frames"])} for n, s in stops.items()},
        "registration": report,
        "images": len(imgs), "points": len(pts),
    }
    (out / "frame.json").write_text(json.dumps(frame, indent=1))
    print(f"{len(imgs)} images, {len(pts)} points -> {out}")


if __name__ == "__main__":
    _P = np.array([[0.0, 0, 0], [0.01, 0, 0], [5.0, 0, 0], [30.0, 0, 0], [30.2, 0, 0]])
    assert len(decimate(_P)) == 3      # two near points share a voxel, so do the two far ones
    _G = np.c_[np.random.default_rng(0).uniform(3, 4, (400, 2)), np.zeros(400)]
    assert on_surface(np.r_[_G, [[3.5, 3.5, -5.0]]]).tolist() == [True] * 400 + [False]   # a point 5 m above flat ground goes
    _xy = np.mgrid[0:30, 0:30].reshape(2, -1).T * 0.1
    _W = np.c_[_xy, 0.2 * _xy[:, 0]][~((np.abs(_xy[:, 0] - 1.5) < 0.15) & (np.abs(_xy[:, 1] - 1.5) < 0.15))]   # a tilted plane with a 30 cm hole
    _f = fill_ground({"a": {"W": _W, "b": np.array([1.5, 1.5, 0.0])}})
    assert len(_f) == 9 and np.abs(_f[:, 2] - 0.2 * (_f[:, 0] - 0.05)).max() < 0.02, (len(_f), _f[:3])   # hole filled on the plane, edge not extended
    assert np.allclose(NED_TO_ENU @ [1, 2, 3], [2, 1, -3]) and np.isclose(np.linalg.det(NED_TO_ENU), 1)
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
