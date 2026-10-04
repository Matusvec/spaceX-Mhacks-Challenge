# Splat pipeline: rover images to a placed, compressed splat

Owner: Matus. Runs on Colab Pro (A100 or H100). Output: `splat.spz` plus the splat part of `scene.json` in a scene bundle (see `contracts.md`).

## Goals, in priority order

1. A scene in the viewer early, even if rough (first bundle within about an hour of starting).
2. No "mush": sharp geometry on the hero formation, no floaters.
3. Small files the browser can load quickly.
4. Correct placement on the terrain, in the `site` frame.

## Step 0: environment (Colab)

- Runtime: A100 or H100, High-RAM.
- Mount Drive. Working root: `/content/drive/MyDrive/pss/` with `raw/`, `colmap/`, `runs/`, `bundles/`, `logs/`.
- Install: `pip install gsplat` (match the wheel to the runtime's PyTorch and CUDA; if no prebuilt wheel matches, gsplat compiles its CUDA kernels on first import, which takes a few minutes), plus `pycolmap` or the COLMAP binary, `numpy`, `pillow`, `tyro`.
- Clone gsplat's repo for `examples/simple_trainer.py`.

## Step 1: download one stop

Script: `pipelines/data/fetch_raw_images.py`.

1. Query the raw-image API for the chosen sols and cameras (`data-sources.md`). Page through until empty.
2. Keep only full-frame images: check `extended.dimension` and `extended.subframeRect` and skip thumbnails, subframes, and sky-only frames.
3. Group by `site` and `drive` (from the image ID or record) and keep the chosen stop. If the formation was imaged from several nearby drives, keep those too; Step 3 handles alignment.
4. Save each full-res PNG and its full JSON record (one `.json` per image) to `raw/<stop>/`.
5. Useful cameras, in order: Navcam L/R (mast, color stereo), Mastcam-Z L/R (zoomable stereo), Front/Rear Hazcam (low on the body, near-ground views), close-up arm images (WATSON) for the formation itself.

## Step 2: camera poses from the camera models

Each record has a CAHVORE model. Use the linear part (C, A, H, V) to get a pinhole camera; ignore O, R, E (distortion terms) at first.

```python
import numpy as np

def cahv_to_pinhole(C, A, H, V):
    """C, A, H, V as length-3 numpy arrays, from camera_model_component_list."""
    A = A / np.linalg.norm(A)
    cx = A @ H                         # principal point x (pixels)
    cy = A @ V                         # principal point y
    fx = np.linalg.norm(np.cross(A, H))
    fy = np.linalg.norm(np.cross(A, V))
    Hp = (H - cx * A) / fx             # camera +X axis in world
    Vp = (V - cy * A) / fy             # camera +Y axis (image down) in world
    R = np.stack([Hp, Vp, A])          # world-to-camera rotation, rows = camera axes
    t = -R @ C                         # world-to-camera translation
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]])
    return K, R, t                     # OpenCV/COLMAP convention: +Z forward, +Y down
```

Checks before trusting it:
- `R` should be orthonormal (within about 1e-3). If not, re-orthonormalize with SVD and log the error.
- The model's pixel units must match the downloaded image size. If the image is downsampled or a subframe, scale and shift `K` using `extended.scaleFactor` and `subframeRect`.
- Frame: camera models are expressed in a rover or site frame for that position. Images from the same site and drive should agree. If images from different drives don't line up, bring each drive into one frame using the PLACES localization (`data-sources.md`).
- Ignoring the distortion terms is an approximation. Navcam distortion is moderate; Hazcams are fisheye and need it. Treat these poses as initialization.

## Step 3: refine with COLMAP

Two routes. Try A first; fall back to B.

- **A, known poses:** write a COLMAP sparse model (`cameras.txt`, `images.txt`, empty `points3D.txt`) from Step 2, then run feature extraction, matching, and `point_triangulator`, followed by `bundle_adjuster`, so COLMAP fixes small pose errors and triangulates sparse points.
- **B, from scratch:** run standard COLMAP SfM on the images. Use the Step 2 poses only to check scale and orientation, then align the result to them (similarity transform) so the output is metric and in the rover frame.

For Hazcams, either undistort with a fisheye model in COLMAP or leave them out of the first run.

Output: `colmap/<stop>/sparse/0` plus `images/`.

## Step 4: masks

Junk in the images becomes junk Gaussians. Before training:
- Exclude or mask the rover's own hardware (deck, wheels, arm) and the sky.
- Quick path: crop out fixed rover regions per camera (they're in the same place in every frame from one camera), and drop frames that are mostly sky.
- Better path, if time: a segmentation model to mask rover parts and sky; keep the masks as images and black out masked pixels so they never train.

## Step 5: train with gsplat MCMC

MCMC densification resists floaters and caps the total Gaussian count, which keeps files small.

```bash
python examples/simple_trainer.py mcmc \
  --data_dir /content/drive/MyDrive/pss/colmap/<stop> \
  --result_dir /content/drive/MyDrive/pss/runs/<run_name> \
  --data_factor 4
```

Exact flag names change between gsplat versions. Run `python examples/simple_trainer.py mcmc --help` and set:
- **Quick run (first bundle):** data factor 4 (quarter resolution), about 7,000 steps, MCMC cap around 300k to 500k Gaussians, SH degree 0 or 1.
- **Full run:** data factor 1 or 2, 30,000 steps, cap around 1M to 2M, SH degree 1 (degree 3 roughly quadruples per-Gaussian color data for little gain here).
- **Depth supervision:** enable the trainer's depth loss (it uses COLMAP sparse points as depth targets). This is the main defense against mush when views are sparse. If PDS stereo range products are available for these sols, they are a stronger depth source.
- Checkpoints every 2,000 to 5,000 steps to Drive; metrics to `logs/<run>.csv` (loss, PSNR, Gaussian count).

## Step 6: crop to what was actually seen

Rover views cover the area near the stops well and everything far away poorly. Crop the splat to the well-observed workspace, about a 10 to 20 m radius around the formation (tune by looking at it). Beyond the crop, the viewer shows HiRISE terrain with the orthophoto draped on it. This one step removes most visible artifacts.

Also prune:
- opacity below about 0.05
- Gaussians far larger than the scene scale (floaters)
- Gaussians below the terrain surface by more than a few decimeters, once aligned (Step 7)

## Step 7: place on the terrain (`map` to `site`)

1. Get the rover's map position for the stop from PLACES (or the waypoint file) and the rover attitude from the image records.
2. Transform the splat from the rover frame into `map`, then into `site` (origin at scene center, +Z up), per `contracts.md`.
3. Sanity check: sample terrain height under the splat's lowest dense layer of Gaussians; they should sit on the ground within a few decimeters. If not, fit a small vertical offset and tilt.
4. Fallback for the demo: place by hand (offset and yaw) until it sits right, and record the transform in `scene.json`.

## Step 8: export and compress

1. Export a standard 3DGS PLY from the final checkpoint (gsplat provides export utilities; or write the PLY from the parameter tensors).
2. Compress to `.spz` (Niantic's spz format) or another format Spark loads; SuperSplat can also convert and inspect.
3. **Check order preservation:** per-Gaussian layers (`layers.bin`) are stored by index. Confirm the compressor keeps Gaussian order (compare positions before and after). If it reorders, compute layers after compression by matching positions, and set `"order_preserved"` accordingly.
4. Write the bundle (`contracts.md`) to `bundles/<scene_id>/`, then copy to the laptop's `scenes/` folder for the backend to serve.

## Mush check and the go/no-go

At the 6 PM check-in, look at the quick-run splat in the viewer:
- Hero formation recognizable with clean edges and few floaters after cropping: **go**, start the full run.
- Still mush: drop the Hazcams, raise depth-loss weight, crop tighter; one more quick run. If still mush, the Mars scene becomes terrain plus orthophoto with a small splat close-up of the formation from the arm-camera images, and everything else continues.

## Matus's loop while runs train

| While this trains | Do this |
|---|---|
| Quick splat run | SAM + CLIP feature extraction on a second runtime (`semantic-layers.md`); write the `map` to `site` placement script |
| Full splat run | Train the AI4Mars terrain model and the autoencoder; lift layers onto the quick-run Gaussians to test the pipeline end to end |
| AI4Mars training | Moon physics precompute on the laptop (`moon-scene.md`) |
| Idle | Export, compress, hand off bundles; help integrate |

Check runs every 10 minutes from the CSV logs on Drive instead of watching continuously.

## Apollo bonus splat (Tier 3)

Same pipeline with route B (COLMAP from scratch): Apollo Hasselblad scans, known 60 mm Biogon lens as the camera prior, filter frames that lack overlap. The Apollo 11 reference project used 60 frames and 30k steps. Expect quality to fall off away from the photo stations; crop accordingly.
