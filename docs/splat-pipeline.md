# Splat pipeline: rover images to a placed, compressed splat

Owner: Matus. Runs on Colab Pro (A100 or H100). Output: `splat.spz` plus the splat part of `scene.json` in a scene bundle (see `contracts.md`).

## Goals, in priority order

1. A scene in the viewer early, even if rough (first bundle within about an hour of starting).
2. No "mush": sharp geometry on the hero formation, no floaters.
3. Small files the browser can load quickly.
4. Correct placement on the terrain, in the `site` frame.

## Step 0: environment (Colab CLI)

Agents do this from the laptop. The browser is not required after a one-time login. See `docs/colab-cli.md`.

```bash
pipelines/colab/launch.sh check          # no GPU, no login prompt
pipelines/colab/launch.sh session        # A100 high-RAM, falls back to T4
pipelines/colab/launch.sh upload         # local data/colmap/<stop>
pipelines/colab/launch.sh train          # gsplat MCMC, streams the log
pipelines/colab/launch.sh pull           # csv + latest checkpoint back to runs/
pipelines/colab/launch.sh stop
```

`launch.sh all` runs session, upload, train, pull, and stop.

- Runtime: A100 or H100, high-RAM (`--gpu A100 --high-mem`). If that quota fails, T4.
- Working root on the VM: `/content/pss/` with `colmap/`, `runs/`, `logs/`. When Drive is already mounted, the same tree is mirrored under `/content/drive/MyDrive/pss/`. Agents do not mount Drive.
- The trainer clones `nerfstudio-project/gsplat` on the VM and runs `pip install -e .` so `examples/simple_trainer.py` matches that CUDA. First install compiles kernels and takes a few minutes.

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
- The model's pixel units must match the downloaded image size. On this raw feed the CAHV is already in the delivered PNG's pixel grid (a Navcam tile's principal point sits outside the tile, and it shifts by the same step as `subframeRect`). Do not shift `K` a second time.
- Train on the frames `cahv_to_colmap.py` keeps, not the whole download. Mastcam-Z `ECM` browse PNGs are grayscale; the debayered color product is `EBY` (Analyst's Notebook product list; the same flag used for published Mastcam-Z DOM reconstructions). Drop narrowband and ND filters, horizon frames, and repeat sols of the same aim (keep the sharpest). Do not stitch different pointings into one picture: that throws away the parallax. Navcam tiles of one exposure are a single pose; `cahv_to_colmap.py` (single stop, Mastcam-Z only) leaves them out, `build_scene.py` stitches them back into one frame.
- Frame: camera models are expressed in a rover or site frame for that position. Images from the same site and drive should agree. If images from different drives don't line up, bring each drive into one frame using the PLACES localization (`data-sources.md`).
- Ignoring the distortion terms only works for Mastcam-Z at 110 mm. Navcam is CAHVORE type 2, a fisheye: the linear model is hundreds of pixels off at the frame corner. `pipelines/data/cahvore.py` resamples to a true pinhole (stereo epipolar error drops from about 1 px to 0.1 px). Hazcams need the same.

### What was actually built (use this)

One stop is one viewpoint: the mast moves under half a metre, so a single-stop splat is a relief that only looks right from the rover. The rover parked three times around the Cheyava Falls rock (site 55 drive 0, site 55 drive 144, site 56 drive 0; 2.0 m, 7.3 m and 2.6 m from it). The pipeline merges them:

```bash
python3 pipelines/data/build_scene.py data/raw data/colmap/cheyava_site_v4    # 6 minutes, CPU only
python3 pipelines/data/check_scene.py data/colmap/cheyava_site_v4             # fails if the stops disagree by more than 3 px
PSS_DATA=data/colmap/cheyava_site_v4 PSS_RUN=cheyava-site-v4 PSS_CAP_MAX=2500000 pipelines/colab/site.sh push
PSS_DATA=data/colmap/cheyava_site_v4 PSS_RUN=cheyava-site-v4 PSS_CAP_MAX=2500000 pipelines/colab/site.sh start   # 20 minutes on an A100
PSS_RUN=cheyava-site-v4 pipelines/colab/site.sh pull
pipelines/make_mars_bundle.sh runs/cheyava-site-v4/ply/point_cloud_29999.ply data/colmap/cheyava_site_v4       # export, terrain class, tint
```

Dataset (`pipelines/data/`):
- Navcam tiles are stitched per exposure and undistorted with the full CAHVORE model. Every colour Mastcam-Z frame aimed at ground within 30 m is used, at any zoom. A frame is kept only where the rover's own stereo measured ground, which removes rover hardware, sky and far hills. The gsplat COLMAP loader has no per-image masks, so each frame is written as rectangular crops of its good area.
- Mastcam-Z's two camera models disagree by 3 to 4 pixel rows. `stereo.align_right` rotates the right eye until matched points share rows (0.02 px after). Without it dense stereo confirms under 10% of a frame.
- Poses come from the camera models plus rover attitude and position. No SfM: features do not match across stops (9 to 23 inliers against about 2,900 within a stop). The stops are lined up on their stereo height maps, then on image texture; `check_scene.py` measures the result in pixels.
- `points3D.txt` is the stereo cloud, so the trainer has depth targets in every image. Navcam gets one white-balance gain to match Mastcam-Z (`colour.py`).
- Navcam comes from the arrival sol of each stop (arm stowed).

Training (`pipelines/colab/site.sh`, which patches a private copy of gsplat's trainer with `vm_patch_trainer.py`):
- MCMC with its opacity and scale regularisers off. A Gaussian here is seen by about 3% of the images; with the regularisers on, 80% of the Gaussians died every 100 steps.
- A needle penalty (longest axis at most twice the middle one). All cameras sit at three spots, so Gaussians stretched along the line of sight look right in training and like spikes from anywhere else.
- Depth loss on the stereo cloud at ten times gsplat's default weight, with the rendered depth floored at 0.5 m (the stock loss is 1/depth and gives NaN on an uncovered pixel). Positions move ten times slower than default: they start on the stereo surface.
- No view-dependent colour (SH degree 0), a per-image bilateral grid for exposure, pose optimisation, anti-aliasing, no world normalisation (the splat stays in east-north-up metres).
- Judge a run with `pipelines/colab/vm_render.py` (orbit, low and top-down views no camera had), not with held-out PSNR: held-out photos sit centimetres from training photos and get no exposure correction, so PSNR stays near 18 dB whether the splat is good or full of spikes.

Known limits of the result: soft from closer than about 2 m (Navcam is 2.5 to 5 mm per pixel there), holes, rover shadows baked in, sparse beyond 9 m (the export crops there). The holes are not where the rover stood (those patches are seen from the other stops and are well filled); they are ground with no stereo starting point or no photo at all, such as the black triangle north of the hero rock.

Tried and rejected, so nobody repeats them:

- **Seeding the gaps** (`build_scene.FILL`, dataset v5): empty 10 cm cells fell from 11.3% to 7.1%, but the viewer showed flat blank patches and more dark specks. Off by default.
- **A fourth stop** (site 55 drive 340, 16 m east): it does not register to the other three (texture correlation 0.02, where the others reach 0.18 and 0.61), and `check_scene.py` refuses the dataset.
- **More Gaussians and steps** (3M, 40k) and **per-frame exposure gains without the colour grid** (dataset v3): no gain, and frame-shaped patches, respectively.

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
