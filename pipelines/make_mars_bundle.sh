#!/usr/bin/env bash
# Trained splat -> finished Mars scene bundle.
#
#   pipelines/make_mars_bundle.sh runs/cheyava-site-v2/ply/point_cloud_29999.ply data/colmap/cheyava_site_v2
#
# The order matters: the export rewrites layers.bin from scratch, so the terrain-class layer
# has to be put back after every export, and the terrain tint takes its colour from the splat.
# Needs .venv-semantic (see pipelines/semantic/train_ai4mars.py), runs/ai4mars/best.pt and runs/semantic/ae.pt.
set -euo pipefail

PLY="$1"
DATASET="$2"                          # the COLMAP dataset the splat was trained on (poses + frame.json)
BUNDLE="${3:-scenes/mars-hero-01}"
PY=.venv-semantic/bin/python
LIFT="${PLY%.ply}.terrain.npz"

# 1. Crop, prune, place on the terrain, write splat.spz and the geometry layers.
python3 pipelines/data/export_scene.py "$PLY" "$BUNDLE" "$DATASET/frame.json"

# 1b. Fine height map of the splat's surface, so the viewer's rover stands on the rocks it shows.
python3 pipelines/data/splat_surface.py "$BUNDLE"

# 2. Terrain class: per-image predictions (once per dataset), lifted onto this splat, written into the layers.
PRED="runs/ai4mars/pred/$(basename "$DATASET")/probs"   # one file per image; a partial folder means an interrupted run
[[ "$(ls "$PRED" 2>/dev/null | wc -l)" == "$(ls "$DATASET/images" | wc -l)" ]] || "$PY" pipelines/semantic/predict_terrain.py "$DATASET"
"$PY" pipelines/semantic/lift_terrain.py "$PLY" "$LIFT" --scene "$DATASET"
"$PY" pipelines/semantic/terrain_layer.py "$BUNDLE" "$LIFT" "${PLY%.ply}.kept_index.npy"

# 3. Visual clusters for text search (SAM regions + CLIP, lifted and clustered). The region step is the slow
#    one: 20 minutes on the laptop GPU, once per dataset. In practice a query only tells rocks from the
#    ground between them (see runs/semantic/queries/), and the layer is flagged as an estimate.
REGIONS="runs/semantic/regions/$(basename "$DATASET")/emb"
[[ "$(ls "$REGIONS" 2>/dev/null | wc -l)" -ge "$(ls "$DATASET/images" | wc -l)" ]] || "$PY" pipelines/semantic/embed_regions.py "$DATASET"
[[ -f "${PLY%.ply}.visual.npz" ]] || "$PY" pipelines/semantic/visual_clusters.py "$PLY" --scene "$DATASET"
"$PY" pipelines/semantic/visual_layer.py "$BUNDLE" "${PLY%.ply}.visual.npz" "${PLY%.ply}.kept_index.npy"

# 4. Tint the grey orbital orthophoto to the splat's colour.
python3 pipelines/data/tint_terrain.py "$PLY" "$BUNDLE"

python3 -c "
import json, sys
s = json.load(open('$BUNDLE/scene.json')); l = json.load(open('$BUNDLE/layers.json'))
print('bundle:', s['splat']['count'], 'Gaussians;', 'layers:', [f['name'] for f in l['fields']])"
