# Semantic layers: making the scene queryable

Owner: Matus (pipelines, training); Humyra curates pins and mineral data. Output: `layers.bin`, `layers.json`, `clusters.json`, `pins.json` in the scene bundle (`contracts.md`).

## Why layers, not just CLIP

On Mars, generic CLIP mostly sees "rocks." So each Gaussian carries several layers, each from the source best suited to it, and queries combine them. Each layer has a true resolution, and the UI shows it so nothing is overclaimed.

| Layer | Source | Can it tell one rock from the next? | Priority |
|---|---|---|---|
| Geometry: elevation, slope, roughness, height above ground | HiRISE DTM + splat geometry | Yes for shape near the rover | Tier 1 |
| Terrain class: soil, bedrock, sand, big rock | Our model trained on AI4Mars | Partly | Tier 2 |
| Rover targets + chemistry | Named targets in `pins.json` from cited sources | Yes, exactly, for analyzed rocks | Tier 2 |
| Mineralogy: olivine, carbonate | CRISM-derived maps | No, area-level (~18 m/px) | Tier 2 |
| Visual semantics: "veined", "layered", "spotted" | SAM masks + CLIP, lifted, autoencoder, clusters | Weakly | Tier 2 |
| Mastcam-Z multispectral color | Mastcam-Z narrowband filters, if available for the stop | Yes, per rock, near field | Tier 3 |

Order of work: geometry first (cheap, always works), then terrain class and pins, then visual semantics.

## The one lifting technique used for every image-based layer

Any per-pixel quantity in the training images (class probabilities, CLIP latents) is moved onto Gaussians the same way: a weighted average over every pixel each Gaussian contributes to, weighted by its alpha-blending weight. This is the training-free idea behind Occam's LGS, and it needs no rasterizer changes in gsplat because gsplat can render arbitrary-dimension "colors".

```python
# For each training view v with a per-pixel feature map T_v of shape [H, W, D]:
#   F = zeros([N, D], requires_grad=True)            # per-Gaussian features
#   img = rasterize(means, quats, scales, opacities, colors=F, sh_degree=None, view v)  # [H, W, D]
#   (img * T_v).sum().backward()                      # dL/dF_i = sum over pixels of w_i,p * T_v[p]
#   accum += F.grad
#   ones-pass: render colors=ones([N,1]) the same way, backward with ones -> per-Gaussian weight sum W_i
# After all views: feature_i = accum_i / max(W_i, eps)
```

Notes:
- Process D in chunks (for example 16 channels at a time) to limit memory.
- Use the trained splat with its final geometry; never retrain geometry here.
- Gaussians with tiny total weight were barely seen; mark their image-based layers as unknown.
- Use about 30 to 80 training views spread around the scene; more views give smoother results, not much better ones.

## Layer 1: geometry (Tier 1)

Per Gaussian, in the `site` frame:
- `elevation_m`, `slope_deg`: sample the DTM (and a slope raster computed from it) at the Gaussian's x, y. Slope from the DTM gradient: `slope = degrees(arctan(hypot(dz/dx, dz/dy)))`.
- `height_above_ground_m`: Gaussian z minus DTM z.
- `roughness_m`: standard deviation of z of neighboring Gaussians within about 0.5 m horizontally (KD-tree). Only meaningful in the cropped near field.

## Layer 2: terrain class from AI4Mars (Tier 2, a trained model)

1. **Data:** AI4Mars from NASA's open data portal (`data-sources.md`). Curiosity Navcam images are grayscale; labels: soil, bedrock, sand, big rock, plus unlabeled pixels to ignore in the loss.
2. **Model:** a pretrained semantic segmentation backbone fine-tuned on AI4Mars (for example SegFormer-B2 or DeepLabV3+ from Hugging Face or torchvision). Input 512 px crops.
3. **Train on Colab H100/A100:** cross-entropy with the ignore index, AdamW, 10 to 30 epochs or until validation mIoU plateaus. Log per-class IoU. Save `ai4mars_seg.pt` to Drive. Keep the validation numbers for the pitch.
4. **Inference on our images:** convert Perseverance images to grayscale first (matches training). Predict class probabilities per pixel. Spot-check 10 images by eye; Curiosity-to-Perseverance transfer is plausible but must be checked.
5. **Lift** the 4 class probabilities onto Gaussians with the technique above; store as `terrain_class` (u8x4).

## Layer 3: rover targets and chemistry (Tier 2)

1. Humyra curates `pins.json` (format in `contracts.md`) from the cited sources in `data-sources.md`: the hero target and nearby analyzed targets, sample names, what was found, and source URLs. Only copied values; no invented numbers.
2. Place each pin in `site` coordinates (from images of the target, the splat, or the target's published location).
3. Per Gaussian: `target_id` of the nearest target within about 2 m (else none), and `dist_to_target_m`.

## Layer 4: mineralogy (Tier 2)

1. Download a CRISM-derived olivine/carbonate map covering the site (`data-sources.md`), georeferenced.
2. Reproject to the `map` frame, sample at each Gaussian's x, y, normalize to 0 to 1, store as `mineral` (u8x2).
3. Also export as a terrain raster (`rasters/`) for the wide view. Label in the UI: "orbital, ~18 m/px".

## Layer 5: visual semantics (Tier 2)

Pipeline (Colab, a second runtime while the splat trains):

1. **Masks:** SAM (or SAM 2) automatic mask generation on 30 to 80 training views at moderate resolution.
2. **Embeddings:** for each mask, crop the masked region (with a little context) and embed with OpenCLIP ViT-B-16 (512-d), the same model the backend uses for text. SigLIP 2 is a stronger alternative; if used, the backend must use SigLIP 2's text tower too.
3. **Feature maps:** paint each mask's embedding into a per-pixel map; where masks overlap, prefer the smaller mask.
4. **Autoencoder:** MLP 512 to 16 latent dims and back (for example 512-256-128-64-16 and mirror), trained on all mask embeddings with an MSE plus cosine loss. Minutes on an H100. Save encoder and decoder; the decoder ships to the backend (`apps/backend/models/ae_decoder.pt`).
5. **Lift** the 16-d latent maps onto Gaussians (technique above).
6. **Cluster:** k-means with k = 256 on the per-Gaussian latents (ignore unseen Gaussians). Store each Gaussian's `visual_cluster` and the centroids in `clusters.json`.
7. **Query (backend):** decode the 256 centroids to 512-d once; at query time embed the text, score each centroid with a LangSplat-style relevancy against canonical negatives ("object", "things", "stuff", "texture"), and return clusters above a threshold. The viewer highlights Gaussians in those clusters.

Stretch: learned per-Gaussian language features (LangSplat-style training) for comparison, only after everything else works.

## Writing the bundle files

Script: `pipelines/colab/write_layers.py`. Inputs: final splat (post-compression order), DTM, slope raster, class probabilities, mineral raster, pins, clusters. Output: `layers.bin` (fixed records per `contracts.md`), `layers.json`, `clusters.json`.

Validation before handoff:
- `count` in `layers.json` equals the splat's Gaussian count.
- Spot-check: Gaussians on the hero formation have high slope or height above ground; sand patches get the sand class; the pin's target_id appears near the pin.
