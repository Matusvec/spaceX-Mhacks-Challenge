"""Metric points from the rover's own stereo pairs.

The left and right eye of one exposure are rigidly mounted and calibrated (0.1 px
epipolar error after undistortion), so their depth needs no SfM. Navcam pairs are
nearly parallel: rectify and run semi-global matching. Mastcam-Z at 110 mm has over
a thousand pixels of disparity at the workspace: match features and triangulate.
"""
import cv2
import numpy as np
from scipy.spatial.transform import Rotation

MIN_DISP = 3.0     # px. Below this the depth is noise (Navcam: beyond ~100 m)
MIN_TEXTURE = 2.0  # grey levels (std over 9x9 px)
MCZ_DEPTH = (1.0, 12.0)   # m. Mastcam-Z workspace frames look at ground this far away; a point outside is a bad match
MIN_RANGE = 0.9    # m. Nearest thing the matcher must reach: the deck under the mast. Too small a search invents surfaces


def rectify(L, R):
    """Common rectified pinhole for a pair -> (K, rover-to-rect R, baseline, size, H_left, H_right)."""
    b = R.C - L.C
    B = np.linalg.norm(b)
    x = b / B
    z = L.R[2] + R.R[2]
    z = z - (z @ x) * x
    z /= np.linalg.norm(z)
    Rr = np.stack([x, np.cross(z, x), z])
    f = L.K[0, 0]
    w, h = L.size
    corners = np.array([[0, 0, 1], [w, 0, 1], [w, h, 1], [0, h, 1]], float).T
    p = np.diag([f, f, 1]) @ Rr @ L.R.T @ np.linalg.inv(L.K) @ corners
    p = p[:2] / p[2]
    K = np.array([[f, 0, -p[0].min()], [0, f, -p[1].min()], [0, 0, 1]])
    size = (int(np.ptp(p[0])), int(np.ptp(p[1])))
    H = [K @ Rr @ F.R.T @ np.linalg.inv(F.K) for F in (L, R)]
    return K, Rr, B, size, H[0], H[1]


def matches(L, R):
    """SIFT matches between the two eyes, in each frame's own pixels."""
    sift = cv2.SIFT_create(6000)
    ka, da = sift.detectAndCompute(cv2.cvtColor(L.image, cv2.COLOR_BGR2GRAY), None)
    kb, db = sift.detectAndCompute(cv2.cvtColor(R.image, cv2.COLOR_BGR2GRAY), None)
    if da is None or db is None or len(da) < 2 or len(db) < 2:
        return np.zeros((0, 2)), np.zeros((0, 2))
    m = [x for x, y in cv2.BFMatcher().knnMatch(da, db, k=2) if x.distance < 0.7 * y.distance]
    return np.float64([ka[x.queryIdx].pt for x in m]).reshape(-1, 2), np.float64([kb[x.trainIdx].pt for x in m]).reshape(-1, 2)


def row_offset(L, R, pa, pb):
    """Median row difference (right minus left) of matched points after rectification, and the focal length."""
    K, Rr, B, size, HL, HR = rectify(L, R)
    ya = cv2.perspectiveTransform(pa[None], HL)[0, :, 1]
    yb = cv2.perspectiveTransform(pb[None], HR)[0, :, 1]
    dy = yb - ya
    return float(np.median(dy[np.abs(dy - np.median(dy)) < 5])), K[0, 0], Rr[0]


def align_right(L, R):
    """Rotate the right eye about the stereo baseline until matched points share rows. Returns px before, after.

    Navcam's two camera models agree to 0.1 px. Mastcam-Z's do not: at 34 mm the right eye sits
    about 4 rows off, which is enough to make semi-global matching fail on 90% of the frame.
    """
    pa, pb = matches(L, R)
    if len(pa) < 50:
        return None, None
    before, f, axis = row_offset(L, R, pa, pb)
    start, best = R.R, (abs(before), R.R)
    for sign in (1, -1):   # the sign depends on axis conventions: try both and keep what the data says
        R.R = start @ Rotation.from_rotvec(sign * before / f * axis).as_matrix().T
        after = abs(row_offset(L, R, pa, pb)[0])
        if after < best[0]:
            best = (after, R.R)
    R.R = best[1]
    return before, row_offset(L, R, pa, pb)[0]


def dense_points(L, R, stride=2, near=MIN_RANGE):
    """Navcam pair -> rover-frame points (N,3), matched from the left view and from the right view.

    Semi-global matching cannot fill the first columns of its reference image, so each eye
    is the reference once (the right one mirrored). A match only counts where both
    rectified images hold real pixels: the empty border matches itself perfectly.
    """
    K, Rr, B, size, HL, HR = rectify(L, R)
    f = K[0, 0]
    gl, gr = (cv2.warpPerspective(cv2.cvtColor(F.image, cv2.COLOR_BGR2GRAY), H, size) for F, H in ((L, HL), (R, HR)))
    full = lambda F: cv2.resize(F.good.astype(np.uint8), F.size, interpolation=cv2.INTER_NEAREST)
    ml, mr = (cv2.erode(cv2.warpPerspective(full(F), H, size, flags=cv2.INTER_NEAREST), np.ones((9, 9), np.uint8)) > 0 for F, H in ((L, HL), (R, HR)))
    # sky and blown-out rock have no texture, and the matcher happily invents depth for them
    textured = lambda g: cv2.blur(g.astype(np.float32) ** 2, (9, 9)) - cv2.blur(g.astype(np.float32), (9, 9)) ** 2 > MIN_TEXTURE ** 2
    ml, mr = ml & textured(gl), mr & textured(gr)
    num_disp = min(int(np.ceil(f * B / near / 16)) * 16, (size[0] - 64) // 16 * 16)
    sgbm = cv2.StereoSGBM_create(minDisparity=0, numDisparities=num_disp, blockSize=5, P1=8 * 25, P2=32 * 25,
                                 disp12MaxDiff=1, uniquenessRatio=10, speckleWindowSize=150, speckleRange=2,
                                 mode=cv2.STEREO_SGBM_MODE_SGBM_3WAY)
    flip = lambda im: np.ascontiguousarray(im[:, ::-1])
    v, u = np.mgrid[0:size[1]:stride, 0:size[0]:stride]
    out = []
    # (disparity, this eye's mask, other eye's mask, where the match sits in the other eye, camera centre)
    for disp, mine, other, sign, centre in ((sgbm.compute(gl, gr), ml, mr, -1, L.C), (flip(sgbm.compute(flip(gr), flip(gl))), mr, ml, 1, R.C)):
        d = disp[v, u].astype(np.float32) / 16
        ok = (d >= MIN_DISP) & mine[v, u]
        ok[ok] = other[v[ok], np.clip((u[ok] + sign * d[ok]).round().astype(int), 0, size[0] - 1)]
        Z = f * B / d[ok]
        out.append(np.stack([(u[ok] - K[0, 2]) * Z / f, (v[ok] - K[1, 2]) * Z / f, Z], 1) @ Rr + centre)
    return np.concatenate(out)


def sparse_points(L, R, max_err=2.0):
    """Mastcam-Z pair -> rover-frame points triangulated from SIFT matches."""
    pa, pb = matches(L, R)
    if len(pa) < 8:
        return np.zeros((0, 3))
    Pa, Pb = (F.K @ np.c_[F.R, -F.R @ F.C] for F in (L, R))
    X = cv2.triangulatePoints(Pa, Pb, pa.T, pb.T)
    X = (X[:3] / X[3]).T
    (ua, za), (ub, zb) = L.project(X), R.project(X)
    keep = (za > MCZ_DEPTH[0]) & (za < MCZ_DEPTH[1]) & (zb > 0) & (np.linalg.norm(ua - pa, axis=1) < max_err) & (np.linalg.norm(ub - pb, axis=1) < max_err)
    return X[keep]


def on_good(F, uv, z):
    """Which projected points land on a trainable cell of the frame."""
    h, w = F.good.shape
    g = F.image.shape[0] // h
    with np.errstate(invalid="ignore"):
        cu, cv_ = np.floor(uv[:, 0] / g), np.floor(uv[:, 1] / g)
        ok = (z > 0) & (cu >= 0) & (cu < w) & (cv_ >= 0) & (cv_ < h)
    ok[ok] = F.good[cv_[ok].astype(int), cu[ok].astype(int)]
    return ok


def cells(F, P):
    """How many of the points land in each coarse cell of a frame."""
    uv, z = F.project(P)
    h, w = F.good.shape
    g = F.image.shape[0] // h
    with np.errstate(invalid="ignore"):
        cu, cv_ = np.floor(uv[:, 0] / g), np.floor(uv[:, 1] / g)
        ok = (z > 0) & (cu >= 0) & (cu < w) & (cv_ >= 0) & (cv_ < h)
    return np.bincount((cv_[ok] * w + cu[ok]).astype(int), minlength=h * w).reshape(h, w)
