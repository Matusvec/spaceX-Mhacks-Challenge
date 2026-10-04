"""JPL CAHV / CAHVOR / CAHVORE camera models from the Mars 2020 raw-image records.

The linear CAHV part is only right near the image centre. Navcam is CAHVORE type 2
(fisheye): at the frame corner the linear model is off by hundreds of pixels, so
Navcam frames are resampled to a true pinhole before anything else uses them.
Math follows JPL's cmod_cahvor_3d_to_2d / cmod_cahvore_3d_to_2d.
"""
from dataclasses import dataclass, replace

import numpy as np


@dataclass
class Model:
    C: np.ndarray
    A: np.ndarray
    H: np.ndarray
    V: np.ndarray
    O: np.ndarray = None
    R: np.ndarray = None
    E: np.ndarray = None
    linearity: float = 1.0   # CAHVORE: 1 perspective, 0 fisheye

    def shifted(self, dx, dy, scale=1.0):
        """Same camera, pixel grid moved by (dx, dy) then scaled. H and V carry the pixel grid."""
        return replace(self, H=(self.H + dx * self.A) * scale, V=(self.V + dy * self.A) * scale)


def parse(rec):
    """Raw-feed record -> Model. Components are 'C;A;H;V[;O;R[;E;type;parm]]'."""
    parts = rec["camera"]["camera_model_component_list"].split(";")
    vec = [np.array([float(v) for v in p.strip("()").split(",")]) for p in parts[:7]]
    m = Model(*vec[:4])
    if len(vec) >= 6:
        m.O, m.R = vec[4], vec[5]
    if len(vec) >= 7:
        m.E = vec[6]
        mtype = int(float(parts[7]))
        m.linearity = {1: 1.0, 2: 0.0}.get(mtype, float(parts[8]))
    return m


def pinhole(m):
    """Linear part -> (fx, fy, cx, cy), rover-to-camera R, t. OpenCV axes: +Z forward, +Y down."""
    A = m.A / np.linalg.norm(m.A)
    cx, cy = A @ m.H, A @ m.V
    fx, fy = np.linalg.norm(np.cross(A, m.H)), np.linalg.norm(np.cross(A, m.V))
    U, _, Vt = np.linalg.svd(np.stack([(m.H - cx * A) / fx, (m.V - cy * A) / fy, A]))
    R = U @ Vt   # nearest orthonormal matrix
    return (fx, fy, cx, cy), R, -R @ m.C


def project(m, P):
    """3D points (N,3) in the model's frame -> pixel coordinates (N,2), distortion included."""
    p = P - m.C
    if m.O is not None:
        zeta = p @ m.O
        lam3 = p - zeta[:, None] * m.O
        lam = np.linalg.norm(lam3, axis=1)
        if m.E is None:   # CAHVOR
            tau = (lam / zeta) ** 2
            p = p + (m.R[0] + m.R[1] * tau + m.R[2] * tau ** 2)[:, None] * lam3
        else:             # CAHVORE
            theta = np.arctan2(lam, zeta)
            e0, e1, e2 = m.E
            for _ in range(20 if np.any(m.E) else 0):   # entrance-pupil shift; zero on Navcam
                c, s, t2 = np.cos(theta), np.sin(theta), theta ** 2
                poly = e0 + e1 * t2 + e2 * t2 ** 2
                ups = zeta * c + lam * s - (1 - c) * poly - (theta - s) * (2 * e1 * theta + 4 * e2 * theta ** 3)
                theta = theta - (zeta * s - lam * c - (theta - s) * poly) / ups
            L = m.linearity
            chi = theta if abs(L) < 1e-8 else (np.tan(L * theta) / L if L > 0 else np.sin(L * theta) / L)
            chi = np.maximum(chi, 1e-12)
            mu = m.R[0] + m.R[1] * chi ** 2 + m.R[2] * chi ** 4
            p = (lam / chi)[:, None] * m.O + (1 + mu)[:, None] * lam3
    alpha = p @ m.A
    return np.stack([p @ m.H / alpha, p @ m.V / alpha], 1)


def undistort_maps(m, K, R, size, depth=5.0):
    """cv2.remap maps: pinhole (K, rover-to-camera R, centre m.C) of `size` (w, h) <- source image.

    ponytail: rays are sampled at one depth. Exact when E is zero (Navcam, Mastcam-Z).
    """
    w, h = size
    u, v = np.meshgrid(np.arange(w, dtype=np.float64), np.arange(h, dtype=np.float64))
    rays = np.stack([(u - K[0, 2]) / K[0, 0], (v - K[1, 2]) / K[1, 1], np.ones_like(u)], -1).reshape(-1, 3)
    src = project(m, m.C + depth * rays @ R)   # rays @ R == (R.T @ ray): camera -> rover
    return src[:, 0].reshape(h, w).astype(np.float32), src[:, 1].reshape(h, w).astype(np.float32)


if __name__ == "__main__":
    # self-check: with no distortion terms, project() must agree with the pinhole decomposition
    m = Model(np.array([1., 2, 3]), np.array([1., 0, 0]), np.array([640., 1000, 0]), np.array([480., 0, 1000]))
    (fx, fy, cx, cy), R, t = pinhole(m)
    P = np.array([[6., 2.5, 2.0], [9., 1.0, 4.0]])
    pc = P @ R.T + t
    assert np.allclose(project(m, P), np.stack([fx * pc[:, 0] / pc[:, 2] + cx, fy * pc[:, 1] / pc[:, 2] + cy], 1))
    # a fisheye pulls off-axis points toward the centre relative to the pinhole
    f = replace(m, O=m.A, R=np.zeros(3), E=np.zeros(3), linearity=0.0)
    assert np.linalg.norm(project(f, P[:1]) - [cx, cy]) < np.linalg.norm(project(m, P[:1]) - [cx, cy])
    assert np.allclose(project(m.shifted(-10, -20), P), project(m, P) - [10, 20])
    print("ok")
