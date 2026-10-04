"""Line one stop's stereo cloud up with another's.

Telemetry (rover attitude + position) places the stops within a few decimetres of each
other. Features do not match across stops (the views are metres and many degrees apart),
but the ground itself does: slide one stop's height map over the other's until the rocks
coincide. Search yaw and horizontal shift, solve the vertical offset, then fit out the
residual tilt. That is good to a couple of centimetres; build_scene.py then sharpens it
with image texture (climb).
"""
import numpy as np
from scipy.spatial.transform import Rotation

CELL = 0.05      # m, height-map cell
CLIP = 0.20      # m, a height difference larger than this is an occlusion edge, not a misfit
SEARCH = 1.5     # m, half-width of the horizontal search around the telemetry position
YAW = 4.0        # deg, half-width of the heading search


def height_map(P):
    """Mean height per cell -> (grid with NaN where empty, origin xy)."""
    origin = np.floor(P[:, :2].min(0) / CELL) * CELL
    ij = ((P[:, :2] - origin) / CELL).astype(int)
    shape = ij.max(0) + 1
    flat = ij[:, 0] * shape[1] + ij[:, 1]
    n = np.bincount(flat, minlength=shape.prod())
    with np.errstate(invalid="ignore"):
        return (np.bincount(flat, weights=P[:, 2], minlength=shape.prod()) / n).reshape(shape), origin


def height_diff(grid, origin, P):
    """Moving points minus the reference height under them; NaN where the reference is empty."""
    ij = np.floor((P[:, :2] - origin) / CELL).astype(int)
    ok = (ij >= 0).all(1) & (ij < grid.shape).all(1)
    out = np.full(len(P), np.nan)
    out[ok] = P[ok, 2] - grid[ij[ok, 0], ij[ok, 1]]
    return out


def misfit(diff, need):
    """Mean clipped height disagreement after removing the vertical offset, and that offset."""
    d = diff[~np.isnan(diff)]
    if len(d) < need:
        return np.inf, 0.0
    dz = np.median(d)
    return float(np.minimum(np.abs(d - dz), CLIP).mean()), float(dz)


def align(ref, mov, pivot, max_points=40000, seed=0):
    """Rigid correction (R, t), X -> R @ X + t, that lays `mov` onto `ref`. Both in the world frame, +Z up.

    Returns the correction and a report. `pivot` is the moving stop's rover position:
    heading is searched about it so yaw and shift stay independent.
    """
    grid, origin = height_map(ref)
    rng = np.random.default_rng(seed)
    near = mov[np.isfinite(height_diff(grid, origin, mov)) | (np.linalg.norm(mov[:, :2] - pivot[:2], axis=1) < 12)]
    P = near[rng.choice(len(near), min(max_points, len(near)), replace=False)] - pivot
    need = 0.25 * np.isfinite(height_diff(grid, origin, P + pivot)).sum()
    before = misfit(height_diff(grid, origin, P + pivot), need)

    def search(P, yaws, half, step):
        best = (np.inf, 0, 0, 0, 0)
        shifts = np.arange(-half, half + 1e-9, step)
        for yaw in yaws:
            Q = P @ Rotation.from_euler("z", yaw, degrees=True).as_matrix().T + pivot
            for dx in shifts:
                for dy in shifts:
                    score, dz = misfit(height_diff(grid, origin, Q + [dx, dy, 0]), need)
                    if score < best[0]:
                        best = (score, yaw, dx, dy, dz)
        return best

    R, t = np.eye(3), np.zeros(3)   # running correction, applied about the pivot
    for yaws, half, step in ((np.arange(-YAW, YAW + 0.1, 1.0), SEARCH, 0.15), (np.arange(-1, 1.01, 0.25), 0.15, 0.03),
                             (np.arange(-0.25, 0.26, 0.125), 0.04, 0.01)):
        Q = P @ R.T + t
        score, yaw, dx, dy, dz = search(Q, yaws, half, step)
        Rz = Rotation.from_euler("z", yaw, degrees=True).as_matrix()
        R, t = Rz @ R, Rz @ t + [dx, dy, -dz]   # dz is how far the moving cloud sits above the reference
        # residual tilt: fit a plane to what is left and rotate it out
        Q = P @ R.T + t
        d = height_diff(grid, origin, Q + pivot)
        ok = np.isfinite(d) & (np.abs(d) < 0.08)
        if ok.sum() > 500:
            a, b, c = np.linalg.lstsq(np.c_[Q[ok, :2], np.ones(ok.sum())], d[ok], rcond=None)[0]
            Rt = Rotation.from_rotvec([-b, a, 0]).as_matrix()
            R, t = Rt @ R, Rt @ t - [0, 0, c]
    after = misfit(height_diff(grid, origin, P @ R.T + t + pivot), need)
    report = {
        "overlap_points": int(np.isfinite(height_diff(grid, origin, P @ R.T + t + pivot)).sum()),
        "height_misfit_before_m": round(before[0], 4), "height_misfit_after_m": round(after[0], 4),
        "shift_m": [round(float(v), 3) for v in t], "rotation_deg": round(float(np.degrees(Rotation.from_matrix(R).magnitude())), 3),
    }
    return R, pivot + t - R @ pivot, report


def climb(score, steps, rounds=5):
    """Coordinate pattern search from zero: maximise score(x), halving the steps each round."""
    x, steps = np.zeros(len(steps)), np.array(steps, float)
    best = score(x)
    for _ in range(rounds):
        moved = True
        while moved:
            moved = False
            for i in range(len(x)):
                for sign in (1, -1):
                    y = x.copy()
                    y[i] += sign * steps[i]
                    v = score(y)
                    if v > best:
                        x, best, moved = y, v, True
        steps /= 2
    return x, best


if __name__ == "__main__":
    # self-check: a bumpy surface moved by a known yaw + shift is recovered
    rng = np.random.default_rng(1)
    xy = rng.uniform(-6, 6, (150000, 2))
    bumps = rng.uniform(-5, 5, (60, 2))
    z = 0.05 * xy[:, 0] + sum(0.25 * np.exp(-((xy - b) ** 2).sum(1) / 0.08) for b in bumps)
    ref = np.c_[xy, z]
    Rz = Rotation.from_euler("z", 2.0, degrees=True).as_matrix()
    mov = (ref - [0.4, -0.3, 0.1]) @ Rz      # world -> displaced: undo is Rz @ X + shift
    R, t, rep = align(ref, mov, np.zeros(3))
    err = np.abs(mov @ R.T + t - ref).max()
    assert err < 0.03, (err, rep)
    x, _ = climb(lambda x: -((x - [0.031, -0.012]) ** 2).sum(), [0.02, 0.02])
    assert np.abs(x - [0.031, -0.012]).max() < 0.002, x
    print("ok", rep)
