#!/usr/bin/env python3
"""Fill points3D for a known-pose COLMAP model (docs/splat-pipeline.md step 3, route A).

  uv run --no-project --with pycolmap python pipelines/data/triangulate.py data/colmap/cheyava_s56d0

Run after cahv_to_colmap.py. SIFT + exhaustive matching, then triangulation with the
poses held fixed. Rewrites <dir>/sparse/0 in place (text). Without sparse points the
gsplat trainer has nothing to initialise from and no depth targets.
"""
import sys
import tempfile
from pathlib import Path

import pycolmap


def main(root):
    root = Path(root)
    images, sparse, db_path = root / "images", root / "sparse/0", root / "database.db"
    db_path.unlink(missing_ok=True)
    pycolmap.extract_features(db_path, images, camera_mode=pycolmap.CameraMode.PER_IMAGE)

    # The extractor hands out image ids in its own order, and triangulation joins on id.
    # Renumber our model to the database's ids (by file name), then give the database our
    # CAHV intrinsics so match verification doesn't run on guessed focal lengths.
    cams = {l.split()[0]: l.split()[1:] for l in (sparse / "cameras.txt").read_text().splitlines() if l.strip()}
    cam_lines, img_lines = [], []
    with pycolmap.Database.open(db_path) as db:
        for line in (sparse / "images.txt").read_text().splitlines():
            if not line.strip():
                continue
            *pose, cam_id, name = line.split()
            row = db.read_image_with_name(name)
            cam_lines.append(" ".join([str(row.camera_id), *cams[cam_id]]))
            img_lines.append(" ".join([str(row.image_id), *pose[1:], str(row.camera_id), name]) + "\n")
        (sparse / "cameras.txt").write_text("\n".join(cam_lines) + "\n")
        (sparse / "images.txt").write_text("\n".join(img_lines) + "\n")
        for stale in ("rigs.txt", "frames.txt"):    # left by a previous run, numbered for the old ids
            (sparse / stale).unlink(missing_ok=True)
        rec = pycolmap.Reconstruction(sparse)
        assert rec.num_images() == db.num_images(), "images/ and sparse/0 disagree; re-run cahv_to_colmap.py"
        for cam in rec.cameras.values():
            cam.has_prior_focal_length = True
            db.update_camera(cam)

    pycolmap.match_exhaustive(db_path)   # ponytail: O(n^2) pairs, fine to ~300 images; switch to match_spatial beyond that
    with tempfile.TemporaryDirectory() as tmp:
        out = pycolmap.triangulate_points(rec, db_path, images, tmp)
    out.write_text(sparse)
    print(out.summary())
    assert out.num_points3D() > 0, "no points triangulated: views share too little parallax or the poses disagree"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
