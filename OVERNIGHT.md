# Overnight log (Scenes and ML)

Kept current by the agent working overnight. Newest entry first under each heading.

## See it (morning quick start)

Both of these may still be running. From `/mnt/data/projects/hackathons/pss-web-main` (a git worktree of
`origin/main`, Claire's app, with uncommitted edits):
```
cd apps/backend && SCENES_DIR=/mnt/data/projects/hackathons/spaceX-Mhacks-Challenge/scenes AE_DECODER_PATH=/mnt/data/projects/hackathons/spaceX-Mhacks-Challenge/runs/semantic/ae_decoder.pt .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
cd apps/web && VITE_BACKEND_URL=http://localhost:8000 npx vite --port 5173 --strictPort
```
Open http://localhost:5173/?scene=mars-hero-01 (press "Frame splat"; "Splat layers" colours it by slope, height,
terrain class; "Find by description" highlights by text, e.g. "light-toned layered rock" or "sand ripples") and http://localhost:5173/?scene=moon-malapert-01 ("Terrain layers": illumination, Earth
visibility, slope, dose estimate). Use `localhost`, not `127.0.0.1`: the backend's CORS list only has that origin.
- Every viewer and backend change is in `pss-web-main/viewer-integration.patch` (28 files; `git apply` from the
  repo root; applies cleanly to `origin/main` 33d1c43; the web build passes). Nothing is committed anywhere.
- Screenshots: `pss-web-main/shots/` (`m13-*` Mars 9 m crop, `m16-*` terrain class, `m9-*`/`m11-*` Moon).
- Rebuild the Mars bundle from a trained splat: `pipelines/make_mars_bundle.sh <ply> <dataset>` (32 s).

## Running right now (Sunday morning, Matus is back)

Goal now: qualify for sponsor prizes. Four parties edit `/mnt/data/projects/hackathons/pss-web-main` at once;
the patch for Claire is on hold until they settle. Backups of that tree: scratchpad `viewer-backup-*.patch`.

- **Agent `grok-integration`**: done; Grok verified with the real key (see Done).
- **Agent `spacetime-multiplayer`**: done (see Done). Local Spacetime server left running on :3000.
- **Agent `web-integration`** (from 10:20): regenerating the patch from the combined tree, clean-build check,
  and a whole-app layout pass now that four sets of changes are together.
- **Me**: rover and camera (done: `scene/cameraRig.ts`, `ui/CameraBar.tsx`: WASD fly, Follow rover, Rover camera).
- Nothing is training. Colab VM still up and billing.

## Verdict on the splat so far (looked at, not assumed)

- **Run 1 (`runs/cheyava-site`, 30k steps) is not good enough.** Held-out photos look fine, but from viewpoints
  no camera had (orbit, low, top-down: `pipelines/colab/vm_render.py`) it is full of spikes and sparkles.
  Cause: all cameras sit at three spots, so Gaussians stretched along the line of sight look perfect in
  training and like needles from anywhere else. Different sols also mean different shadows.
- **04:50 v5 (gap seeding) is close to a wash on the trainer-side novel views** (looked at 9 of 15 pairs):
  empty 10 cm cells inside the crop fell from 11.3% to 7.1% (sparse: 22.3% to 19.1%), and the dark blob on
  the hero rock is gone, but new dark specks appear in some foregrounds. The black triangle north of the hero
  rock and the gashes south-west of it are unchanged: those are the 0.6% no photo sees.
- **05:56 Fourth stop (site 55 drive 340) tried and rejected before training.** It is 16 m east of the hero
  rock. The builder could not register it to the other three: only 3,525 overlapping points, the height
  search moved it 1.7 m and 1.0 m (the other stops move by centimetres), and the image-texture match found
  no lock (correlation 0.02, against 0.61 and 0.18 for the others). `check_scene.py` refused the dataset
  ("stops are misaligned by more than 3 px"). Not trained; experimental dataset deleted; recipe unchanged.
- **05:00 Verdict: keep v4.** In Claire's viewer from twelve viewpoints (`shots/m21-v4-vs-v5-*.png`, looked at A):
  v5 loses the blob on the hero rock and the small east hole, but adds a flat blank tan patch beside the
  hero rock, more dark specks in five foregrounds, and larger gaps at the south-west. Gap seeding is now off
  by default (`build_scene.FILL`). The v5 test bundle is still at `?scene=mars-hero-v5-test` if you want to
  see for yourself; `rm -r scenes/mars-hero-v5-test` removes it.
- **04:20 Why the splat has holes.** Not the rover footprints: those are seen from the other stops and are well
  filled (2,000 to 7,900 Gaussians per m2). Inside the 9 m crop 22% of 10 cm cells have under 5 Gaussians;
  62% of those are cells where stereo left no starting point, and only 2% are seen by no photo. The trainer
  makes new Gaussians only by splitting existing ones, so an unseeded patch stays empty. `build_scene.fill_ground`
  now seeds gaps at the mean height of measured neighbours within 30 cm (never past the measured edge).
- **04:10 v4 confirmed better than v2 in Claire's viewer** (`shots/m17-v2-vs-v4-*.png`, looked at): fewer spikes,
  sharper from the west, smaller holes, 60 fps with 972k Gaussians. Slightly worse: one small dark blob on
  the hero rock's lower right, a thin dark streak on the rock behind it. The new pin's marker pole (0.8 m
  thick, sized for the 2 km view) hid the rock; the viewer agent thinned it to 8 cm (in the patch, 18 files).
- **03:56 Run `cheyava-site-v4` is the new best and is in the bundle** (30k steps, 2.5M Gaussians, dataset v4).
  Compared with v2 from the same novel viewpoints: sharper rocks from the west and south-west (the side
  the extra Mastcam-Z frames cover), a smaller and cleaner rover-footprint hole, fewer dark spikes, crisper
  mid-ground at low angles. Still soft in the nearest metre and still a pale patch on the hero rock. Bundle:
  972,047 Gaussians, 16 MB, five layers, terrain class on 97.4% of Gaussians. Roll back to v2 with
  `pipelines/make_mars_bundle.sh runs/cheyava-site-v2/ply/point_cloud_29999.ply data/colmap/cheyava_site_v2`.
- **03:10 Dataset v4.** The softness is the photos, not the model: 3M Gaussians for 40k steps
  (`cheyava-site-v2-big`) looked the same as 1.5M for 30k, so v2 stayed. What does add detail: 34 mm, 63 mm and
  110 mm Mastcam-Z frames at the other two stops, 3 to 10 times sharper than Navcam on the ground that looks
  soft. Getting them in needed three fixes, each found by looking at the output: Mastcam-Z's right eye is
  3 to 4 pixel rows off the left in the camera models (stereo confirmed only 8% of a frame until
  `stereo.align_right` corrected it to 0.02 px); close-ups of the deck calibration target and of the drill
  held in front of the camera had to be excluded; crops with no measured ground are skipped.
- **02:30 Seen in Claire's viewer** (`pss-web-main/shots/m7-real-v2-30k-*.png`, looked at the overview and the
  rover-eye view myself): the splat is a 30 m disc sitting on the tinted terrain, hue now matches the
  terrain around it. From rover eye height it reads as Mars: the rocks and sand around Cheyava Falls are
  recognisable. Weak points visible there: the outer ring (about 8 to 15 m) is grainy flakes, the foreground
  is soft, a few thin dark spikes and coloured sparkles remain.
- **02:27 Current best is in the bundle: run `cheyava-site-v2`, 30k steps** (`runs/cheyava-site-v2/ply/`).
  Looked at from novel viewpoints (`pipelines/colab/vm_render.py`): warm consistent colour, no spike
  streaks, rocks recognisable from standing and orbit views. Still soft from closer than about 2 m, sparkle
  junk inside the three rover-footprint holes, one sand patch washed out to pale pink. Held-out PSNR 18.2 is
  not a useful number here (held-out views get no exposure correction). Exported: 846,621 Gaussians, 14 MB.
- **02:20 Dataset v3 (frames pre-matched in exposure, no colour grid in training) lost** to v2 on looking:
  frame-shaped dark and light patches show on the ground. Stopped at 24k. `colour.py` now defaults to the v2 behaviour (one white-balance gain for all
  Navcam frames, `PER_FRAME = False`); training keeps the per-image colour grid.
- **01:57 Variant test, looked at side by side:** the needle penalty takes needles from 17.6% of Gaussians to
  0.1% and the spike streaks are gone. Dataset v2 colours are warm and consistent instead of olive. All
  variants are still soft at 7000 steps; ground seen only by Navcam (2.5 to 5 mm per pixel) will stay soft
  from closer than about 2 m. The Mastcam-Z area still comes out paler than its surroundings.
- **Fix being tested:** a needle penalty in the private trainer copy (`pipelines/colab/vm_patch_trainer.py`),
  stronger depth weight, no view-dependent colour, positions held near the stereo surface.
- **Dataset v2** (`data/colmap/cheyava_site_v2`): Navcam at delivered resolution (was halved), Navcam white
  balance matched to Mastcam-Z (the splat had a patch of one colour inside the other), tile seams trimmed.

## Done

- 11:09 **Live at https://planetary-scene-studio.vercel.app** (Vercel, project planetary-scene-studio; redeploy with
  `scripts/deploy_vercel.sh --deploy` in pss-web-main, backend on :8000 running). Landing page with one access
  code (codes are in `~/.config/pss-studio/org-codes-pss-studio-mhacks.env`, not in the repo), "Your scenes" per
  organisation with who is live, in-tab Mars/Moon switch, restyle (Space Grotesk, no pills, regrouped panels),
  concept render swipe in the viewer, team chat and shared concept renders through SpacetimeDB. Everything is
  on `main`. Colab VM stopped at 10:40.
- 10:25 **Grok is live with a real key: text, Imagine and Voice all PASS** (`smoke_grok.py`). One real concept
  render on our own captured Mars view took 11.8 s and kept the terrain and camera angle while adding three
  domes, tunnels, solar panels and a pad (`docs/figures/grok_imagine_view_vs_render.jpg`, looked at). This is
  the SpaceXAI eligibility item, now actually calling the Imagine and Voice APIs.
- 10:22 **Shared session moved to Spacetime's hosted service**: module published as `pss-studio-mhacks`
  (dashboard https://spacetimedb.com/pss-studio-mhacks), app pointed at it in `apps/web/.env.local`, and the
  two-browser proof passes against it. Not yet tried from a second physical laptop.
- 10:20 **SpacetimeDB is the live backend for presence, user pins, placed modules and rover drives.** Module in
  `pss-web-main/spacetime/` (5 tables, 14 reducers), client in `apps/web/src/multiplayer/`, "Shared session"
  panel with Add pin / Drive here, chat: "drive to pin 2", "add a pin here as <note>". Works offline in
  memory ("offline, not shared") and uploads on reconnect. I re-ran the two-browser proof
  (`node shots/two-clients.mjs`: "two clients: ok") and looked at `shots/mp-3-ben-rover-driving.png`.
  Local server on :3000 (`spacetime start`, v2.10.2). **Not tested:** the hosted service and a real second
  laptop; that needs `spacetime login` by Matus (steps in `spacetime/README.md`).
- 10:05 **Grok Imagine, Grok chat badge and Grok Voice are built, but NO real xAI call has run: there is no key.**
  Backend `render.py` (`POST /concept`: sends the user's captured 3D view to xAI's image-edit endpoint,
  model `grok-imagine-image-2.0`), `voice.py` (speech-to-text and text-to-speech), `smoke_grok.py`. Viewer:
  "Concept render" with an idea box in "Where to build", side-by-side result labelled "AI concept render by
  Grok Imagine. Not data.", gallery, mic button in chat, per-message "read by Grok" / "local reader" tag.
  Checked by me without a key: all five xAI request shapes are accepted up to the key check; endpoints
  return 503 naming `XAI_API_KEY`. **To finish:** put `XAI_API_KEY=...` in
  `pss-web-main/apps/backend/.env` (no restart), run `apps/backend/.venv/bin/python apps/backend/smoke_grok.py`.
- 10:00 **Scene look** ("Presentation fill" toggle: Mars sky and haze, ground beyond the tile, grain, soft splat
  edge; Moon dark beyond the tile), **Sources button** (no links in the panels; one dialog), **camera**
  (WASD fly, Follow rover, Rover camera). All looked at in screenshots.
- 09:40 (Sunday, with Matus) **Rover rebuilt in the viewer**: six wheels on a rocker-bogie suspension that each
  follow the ground, body tilts with the slope, turns on the spot then follows a smooth route, wheels roll
  and steer; double-click the terrain to drive there. Fixed the planner reading heights about 50 m off
  (it assumed square cells; Mars is 1896.68 x 2000 m). Inside the splat the rover stands on the splat's own
  surface (`pipelines/data/splat_surface.py`, 10 cm cells, new optional `splat_surface` in the contract).
  New viewer files: `scene/roverModel.ts`, `scene/roverDrive.ts`, `scene/splatSurface.ts`.
- 05:20 **Regolith shielding factors sourced** (`scenes/moon-malapert-01/shielding.json`, `pipelines/moon/shielding.py`):
  four dose-versus-depth points stated in the text of Matthia & Berger 2024 (Space Weather), 0 to 0.6 m at
  the paper's 3 g/cm3. I re-fetched the PDF and found all four sentences. The curve is NOT monotonic: factor
  0.71 at 7 cm, back up to 0.77 at 30 cm (secondary neutrons), 0.66 at 60 cm. Nothing digitised from a figure.
  It is a model result for cosmic rays at solar minimum, so the UI must call it an estimate.
  **Slider is in the viewer** (`shots/m23-shielding-panels-*.png`, looked at): on the Moon, pick the
  dose_estimate layer and "Regolith over the habitat" runs 0 to 0.60 m, showing the factor and the shielded
  range (347 to 517 mSv/yr with none, 227 to 339 at 0.60 m). The paper's four values are buttons with the
  quoted sentence and source; between them it says the straight lines are our choice. Scorecards unchanged.
- 05:10 **Cheyava Falls pin has 15 cited findings** (`scenes/mars-hero-01/pins.json`): rock type, SHERLOC
  organics, PIXL results for the leopard-spot rims and cores, "likely vivianite and greigite", calcium sulfate
  veins, olivine and carbonate grains, biosignature status, and the Sapphire Canyon core (sample 25, sol
  1215). Every value is quoted from the Nature paper (Hurowitz et al. 2025, open access), two JPL releases
  or NASA's sample table; I re-fetched the pages and found 10 of 10 spot-checked quotes. No wt% or ppm
  values: those are in supplementary tables nobody opened, so they are left out.
  In the viewer (`shots/m22-pin-science-ui.png`, looked at): the rover chat answers "What minerals are here?"
  with the findings folded to four plus "Show all", six sources listed once and numbered; the Pins panel
  shows the sample and a "15 cited measurements" fold with a source link on each.
- 04:45 **Mars mineral rasters written from real orbital products** (`pipelines/data/fetch_mars_minerals.py`,
  `scenes/mars-hero-01/rasters/`): CRISM olivine index and 2.5 micron carbonate band depth (18 m/px, PDS
  product FRT00005C5E) and four unit masks from the Zenodo western-rim map. **Neither product covers the
  rover site**: together they cover the east third and the west corners of the 2 km window. The carbonate
  band depth is above 0.005 in 0.2% of covered pixels, so there is no carbonate detection to claim. The CRISM
  product sat about 300 m off the HiRISE basemap and was shifted by correlating it with the orthophoto.
  Now in the viewer (`shots/m20-mars-minerals-topdown.png`, looked at: strip on the east side, unit map in the
  west corners, centre left clear). No-data is transparent and the legend says "Uncolored areas have no data,
  which is not a low value". The carbonate layer's text states its median (-0.0031) and that a light cell is
  not a detection.
- 04:40 **Text search works end to end in Claire's app** (`shots/m19-query-*.png`, looked at one): a "Find by
  description" box calls a new backend `POST /query` and paints the matching Gaussians. "light-toned layered
  rock" lands on rock slabs (20% of Gaussians), "sand ripples" on the ground between them (48%). First query
  3.6 s (loads CLIP on CPU), later ones under 0.7 s, 60 fps with a highlight on. The panel says it is an
  estimate and that it tells rocks from ground, not rock types. Backend extras are optional
  (`apps/backend/requirements-query.txt`); without them `/query` answers 503 and the rest still works.
- 04:30 **Visual-semantic search layer built (Tier 2), with a plain verdict**: SAM regions + CLIP, lifted and
  clustered into 256 (`pipelines/semantic/`, figures in `runs/semantic/queries/`, looked at one). Text queries
  only tell discrete rocks from the ground between them: "light-toned layered rock" and "dark boulder"
  highlight much the same rocks, "sand ripples" and "wheel tracks" much the same ground. The limit is CLIP on
  Mars terrain (raw region scores show the same split). In the bundle as `visual_cluster` + `clusters.json`,
  flagged as an estimate. `make_mars_bundle.sh` now writes all six layers (59 s).
- 04:05 `docs/splat-pipeline.md` now describes the pipeline that was actually built (commands, why each
  training setting is there, known limits). `scenes/mars-hero-01/pins.json` has one pin, Cheyava Falls, at
  its measured site position (-2.56, -0.58, 0.1), with only the facts and URLs already in
  `docs/data-sources.md` and no measurements. Humyra: add chemistry and the other pins from cited sources.
- 03:25 **Backend path tested**: both scenes load in the viewer through Claire's FastAPI backend (range
  requests, CORS, content types checked). One backend fix: scene files now send `Cache-Control: no-cache`,
  because the browser kept showing the old splat after a re-export. **Terrain class seen in the viewer on
  real data** (`shots/m16-layer-terrain_class-*.png`, looked at): bedrock over most of the ground, sand
  patches, big_rock on the larger rocks, labelled "estimate". Not tested: another machine on the network,
  two browsers at once.
- 03:19 **One command rebuilds the Mars bundle from a trained splat** (32 s):
  `pipelines/make_mars_bundle.sh <ply> <dataset>` runs export (crop, prune, place, compress, geometry layers),
  terrain class (predict, lift, write into `layers.bin`) and the terrain tint, in the order they depend on.
  Ran it on the v2 splat: `scenes/mars-hero-01` now has 635,906 Gaussians and five per-Gaussian layers
  including `terrain_class` (97.6% of Gaussians classified, flagged as an estimate).
- 03:15 **Terrain-class model trained and lifted (Tier 2)** (`pipelines/semantic/`, `runs/ai4mars/`): SegFormer-B1
  fine-tuned on AI4Mars for 79 minutes on the laptop GPU. Test mIoU 0.68 / 0.73 / 0.83 on the three test
  splits; soil, bedrock and sand score 0.81 to 0.98, big_rock only 0.12 to 0.44. Lifted onto the v2 splat by
  projecting Gaussian centres (not the rasterizer method in the spec): 97% of Gaussians inside the crop get a
  class. Looked at `runs/ai4mars/lift/cheyava-site-v2_29999_views.jpg`: outcrop is bedrock, the dune is sand,
  large boulders are big_rock, small rocks are missed. Transfer to Perseverance is judged by eye only.
  In the bundle since 03:19.
- 03:12 **Bundle re-exported with a 9 m crop and a floater prune**: 635,906 Gaussians, 10.6 MB. Viewer agent
  re-shot it (`shots/m13-*`): clean disc, confetti rim gone, 58 to 60 fps. Left over: a blob cluster at the
  south-west edge, a few dark spikes by one rock, two small gaps east of the rock.
- 02:50 **Splat layers in Claire's viewer:** a control colours the Mars splat by a field of `layers.bin` (slope,
  height above ground, roughness, elevation; class fields supported for the terrain-class layer). 60 fps.
  Patch regenerated (16 files). Height above ground shows rocks only weakly: it is measured against the 1 m
  orbital terrain.
- 02:35 **Viewer integration finished** (agent report, screenshots looked at): v2 splat renders in the right
  place, clearly sharper than the step-7000 one, 60 fps (vsync-capped) with 846k Gaussians. A 9 m crop looks
  cleanest (beyond that density falls off and the rim is speckle); the exporter is being set to 9 m.
  Viewer changes: terrain lowered under the splat, raster layers for the Moon, grey Moon tint, a fix for a
  wall artifact at the terrain edge. Not tested: two browsers at once, the FastAPI backend path, a real
  on-screen window. The viewer does not read the per-Gaussian `layers.bin` yet.
- 02:27 Terrain texture tinted to the splat's colour (`pipelines/data/tint_terrain.py`; HiRISE is one band).
  `scene.json` records that it is a presentation tint; the original is `terrain_texture_gray.jpg`.
- 02:10 Moon bundle: slope raster re-encoded to 0-50 deg; shaded-relief `terrain_texture.jpg` computed from
  the LOLA DEM, labelled as computed.
- 01:55 **Moon layers show in Claire's viewer** (worktree `/mnt/data/projects/hackathons/pss-web-main`, dev
  server http://127.0.0.1:5199, open `?scene=moon-malapert-01`): a "Terrain layers" dropdown drapes
  illumination, Earth visibility, slope and the dose estimate (marked as an estimate) on the terrain with
  legend, source and resolution. Screenshots `shots/m5-moon-*.png`. Uncommitted working-tree edits there.
- 01:55 Mars terrain size fix confirmed in the viewer by correlation (scale 1.00, shift 0.00 m; weak signal).
  Left for Claire: `cellSizeM()` uses the east-west cell for both axes, so path lengths and module
  footprints are about 5% short north-south.
- 01:38 **Mars terrain was drawn 5.45% too wide east-west** (the map is equirectangular at the equator, the
  site is at 18.5 N). Found independently by the export and viewer agents. Fixed: `scene.json` now says
  `size_m: [1896.68, 2000]`, and `fetch_mars_terrain.py` writes that.
- 01:33 **Viewer integration (interim):** Claire's viewer (worktree `/mnt/data/projects/hackathons/pss-web-main`)
  renders terrain, texture and the step-7000 splat in the right place and orientation. Screenshots in its
  `shots/`. One viewer change: the drawn terrain is lowered 0.6 m under the splat so it stops hiding it.
- 01:26 **Moon bundle built:** `scenes/moon-malapert-01` with terrain, slope, illumination (0 to 81.6%),
  Earth visibility (0 to 98%), dose estimate (flagged estimate). Regenerate with the four scripts in
  `pipelines/moon/` (3 minutes). Skipped: terrain texture, shielding curve. Not yet loaded in the viewer.
- 01:20 **Export pipeline works:** `python3 pipelines/data/export_scene.py <ply> scenes/mars-hero-01` crops to
  15 m, places on terrain (3 mm after fit), writes `splat.spz` (SPZ v3) + geometry `layers.bin`. The bundle
  currently holds the step-7000 splat of run 1 (placeholder until a good run exists).
- 01:30 Run 1 finished and pulled: `runs/cheyava-site/ply/point_cloud_29999.ply`, eval sheets in `sheets/`.
- 01:05 Dataset rebuilt: `data/colmap/cheyava_site`, 141 images, 3 rover stops, stops agree within 1 px
  (`pipelines/data/check_scene.py`). Fixed a Mastcam-Z frame where the blurred arm leaked in.
- 00:58 Found why the first run turned to mush: MCMC opacity/scale regularisers. A Gaussian here is seen by
  about 3% of images, so the regulariser starves it; 80% died every 100 steps. Off now. Diagnostic at 4000
  steps: training loss 0.027 (was 0.17), relocations 1.5k (was 1.2M).
- 00:47 Fixed NaN crash at step 600: gsplat's depth loss is 1/depth with no floor. Floored at 0.5 m in a
  private copy of the trainer on the VM.
- 00:43 gsplat built on the VM without the 3DGUT kernels (they take 30+ minutes and are unused), in its own
  cache `/content/pss_site/torch_ext`.

## Next

1. Judge the run at step 7000 and at the end (held-out renders, not just PSNR: held-out views get no
   exposure correction, so PSNR reads low).
2. Pull PLY + checkpoint, run the export pipeline, put `splat.spz` in `scenes/mars-hero-01`.
3. If ground near the rover positions is thin: switch crops to per-pixel masks and retrain.
4. Tier 2 if time: AI4Mars terrain-class layer.

## Needs you (not done without a yes)

- Stop the Colab VM. It costs 6.77 units/hr and another agent shares it.
- Push to GitHub. Nothing is committed.
