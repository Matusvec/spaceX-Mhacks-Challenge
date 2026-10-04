# Data sources

Every input is public. Use only what is listed here (or add it here first, with a link), so every number in the app is traceable.

## Mars: picking the hero site (do this first, about 20 minutes)

We want a distinctive formation, not flat ground. Formations with relief give camera matching strong features and parallax, and give the demo a focal object. Three candidates:

| Candidate | Rover | When | Why | Risk |
|---|---|---|---|---|
| Cheyava Falls (Neretva Vallis, Jezero) | Perseverance | July 2024, around sols 1205 to 1220 (Mastcam-Z workspace mosaic on sol 1217) | NASA's clearest potential sign of ancient life (announced Sept 2025); about 1 m rock with white veins and "leopard spots"; days of close imaging from many cameras | Small object; confirm it sits inside the 1 m terrain model |
| Skinner Ridge + Wildcat Ridge (Jezero delta) | Perseverance | July 2022 | Layered sedimentary cliff face next to the rock with the mission's most abundant organic detections at the time; on the delta near the landing site, so inside the terrain model | Less famous story |
| Mont Mercou (Gale Crater) | Curiosity | March 2021, sols about 3048 to 3080 | 6 m cliff; 126-image 360 panorama, two panoramas from about 40 m taken for stereo, 60 MAHLI + 11 Mastcam selfie images at its base | Different rover and site; check whether Curiosity raw records include camera models |

### Selection procedure

1. Open the **Analyst's Notebook** (Mars 2020 and MSL notebooks): https://an.rsl.wustl.edu/ . Use the traverse map and sol-by-sol activity to find which sols image each formation.
2. For each candidate, query the raw-image API for those sols (below) and count images per stop by camera: Navcam L/R, Front and Rear Hazcam, Mastcam-Z L/R (or Curiosity Navcam/Mastcam/MAHLI).
3. Pick the stop with the most images of the formation from the most distinct positions and heights.
4. Terrain check (Perseverance sites): download NASA's waypoint file and confirm the stop lies inside the DTM bounds (see "Terrain" below). In Python:

```python
import json, urllib.request
url = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
wp = json.load(urllib.request.urlopen(url))
for f in wp["features"]:
    p = f["properties"]
    if 1205 <= int(p.get("sol", -1)) <= 1220:
        print(p.get("sol"), p.get("site"), p.get("drive"), f["geometry"]["coordinates"])
```

Field names may differ; print one feature first. The landing-site TRN DTM covers roughly lon 77.22 to 77.58 E, lat 18.31 to 18.67 N. If the stop is outside, use the wider Mars Sample Return TRN mosaics.

Record the decision in `scenes/<scene_id>/scene.json` and tell the team.

## Mars rover images

| What | Where | Notes |
|---|---|---|
| Perseverance raw images, browse | https://mars.nasa.gov/mars2020/multimedia/raw-images/ | Filter by sol and camera to eyeball coverage |
| Perseverance raw images, JSON API | `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=100&page=0&order=sol+desc&search=NAVCAM_LEFT\|NAVCAM_RIGHT` | Add a sol range with `condition_2=1205:sol:gte&condition_3=1220:sol:lte` (if the filter syntax fails, drop it and filter in code). Each record has `camera.camera_model_type` (CAHVORE), `camera.camera_model_component_list`, `camera.camera_position`, `camera.camera_vector`, `attitude`, `extended` (mastAz, mastEl, xyz, dimension, subframeRect, scaleFactor), and `image_files.full_res` (PNG) |
| Curiosity raw images | https://mars.nasa.gov/msl/multimedia/raw-images/ | For Mont Mercou; check the JSON record format before committing |
| PDS Imaging Node, Mars 2020 bundles | https://pds-imaging.jpl.nasa.gov/volumes/mars2020.html | Calibrated images and derived stereo products (range/XYZ) useful as depth supervision. Releases lag the mission by months; confirm your sols are released |
| Mars 2020 rover localization (PLACES) | https://pds-geosciences.wustl.edu/missions/mars2020/places.htm | Official rover position per site/drive; used to place the splat on the terrain |
| Mastcam-Z galleries | https://mastcamz.asu.edu/ | Finished mosaics for visual reference |
| Example raw record | https://mars.nasa.gov/mars2020/multimedia/raw-images/NLF_0017_0668451937_008ECM_N0030578NCAM00195_01_290J | |
| API notes | https://gist.github.com/wvovaw/363b98fdc034bd4a03c09ab102328943 | Query parameters for the raw feed |

## Mars terrain and science

| Layer | Source | Resolution | Notes |
|---|---|---|---|
| Terrain (Jezero, landing area) | USGS Mars 2020 TRN HiRISE DTM: https://astrogeology.usgs.gov/search/map/Mars/Mars2020/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40 (also https://catalog.data.gov/dataset/high-resolution-imaging-science-experiment-digital-terrain-model-mosaic-for-mars-2020-terr) | 1 m/px | Built to map landing hazards for Terrain Relative Navigation |
| Terrain (wider Jezero) | USGS Mars Sample Return TRN HiRISE DTM mosaics: https://astrogeology.usgs.gov/search/map/mars-sample-return-terrain-relative-navigation-hirise-dtm-mosaic | 1 m/px | If the hero stop is outside the landing-area DTM |
| Terrain (other sites, e.g. Gale) | HiRISE DTMs: https://www.uahirise.org/dtm/ | ~1 m/px | For Mont Mercou |
| Orthophoto | USGS Jezero controlled orthomosaics: https://astrogeology.usgs.gov/maps/mars-2020-jezero-crater-landing-site-controlled-orthomosaics | ~25 cm to 1 m | Drape on terrain |
| Mineralogy | Olivine-carbonate mineralogy of Jezero: https://arxiv.org/pdf/1904.11414 ; Jezero western rim maps: https://zenodo.org/records/22257754 ; NASA Jezero minerals: https://science.nasa.gov/photojournal/jezero-crater-minerals/ | orbital, ~18 m/px | Area-level only; never present as per-rock |
| Sample science | NASA Mars rock samples: https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/ ; PNAS, Sampling Mars: https://www.pnas.org/doi/10.1073/pnas.2404255121 ; Cheyava Falls: https://en.wikipedia.org/wiki/Cheyava_Falls ; Planetary Society explainer: https://www.planetary.org/articles/a-biosignature-on-mars-unpacking-perseverances-cheyava-falls-find ; NASA biosignature release: https://www.jpl.nasa.gov/news/nasa-says-mars-rover-discovered-potential-biosignature-last-year/ | per target | Curate 5 to 10 pins into `pins.json`, values copied from sources only |
| Terrain-class training data | AI4Mars: https://data.nasa.gov/dataset/ai4mars-a-dataset-for-terrain-aware-autonomous-driving-on-mars ; paper: https://openaccess.thecvf.com/content/CVPR2021W/AI4Space/papers/Swan_AI4MARS_A_Dataset_for_Terrain-Aware_Autonomous_Driving_on_Mars_CVPRW_2021_paper.pdf | per pixel | Labels: soil, bedrock, sand, big rock. Curiosity Navcam images (grayscale) |
| Reference viewer | perseverance-traverse-3d: https://github.com/enomis-dev/perseverance-traverse-3d | | Shows HiRISE DTM + traverse in the browser |

## Moon (Malapert Massif)

| Layer | Source | Resolution | Notes |
|---|---|---|---|
| Terrain, slope, laser points | PGDA South Pole Landing Site LOLA DEMs: https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/ (Site 23, Malapert massif) | 5 m/px | GeoTIFFs in south polar stereographic meters, MOON_ME frame (DE421). Includes slope and uncertainty maps. No illumination or Earth-visibility products: we compute those |
| Far-field horizon terrain | PGDA LOLA polar products: https://pgda.gsfc.nasa.gov/ (larger-extent, coarser south pole DEMs) | 20 to 60 m/px | Needed because distant mountains set the horizon for sunlight and Earth visibility |
| Imagery | LROC low-Sun controlled NAC mosaic of Malapert: https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_MALAPERTLO1 ; LROC feature: https://lroc.im-ldi.com/images/1294 | ~1 m/px | Drape on terrain |
| Site context | Artemis III candidate regions (13 to 9): https://www.hou.usra.edu/meetings/lpsc2026/pdf/1901.pdf ; Mons Malapert traverse study: https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2024JE008905 ; LOLA south pole: https://iopscience.iop.org/article/10.3847/PSJ/acf3e1 ; Lunar South Pole Atlas: https://www.lpi.usra.edu/lunar/lunar-south-pole-atlas/ | | |
| Sun and Earth positions | JPL DE421 ephemeris via Python `skyfield` (Moon frame files: `moon_080317.tf`, `pck00008.tca`, `moon_pa_de421_1900-2050.bpc`) | | See `moon-scene.md` |
| Radiation baseline | First radiation measurements on the lunar surface (Chang'e 4): https://www.science.org/doi/10.1126/sciadv.aaz1334 | | About 1,369 microsieverts per day measured at the surface |
| Shielding | Radiation exposure and shielding effects on the lunar surface (2024): https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2024SW004095 ; regolith shielding review: https://iopscience.iop.org/article/10.1088/1361-6498/ae7d37 | | Source for regolith shielding curves |

## Apollo (Tier 3 stretch)

| What | Where |
|---|---|
| Apollo surface photo scans | Apollo Lunar Surface Journal; ASU Apollo Image Archive |
| Proven method | Apollo 11 splat from 60 Hasselblad scans, COLMAP, 30k steps: https://github.com/jdahiya/apollo-11-splats |
| Suggested target | Apollo 17 Station 6 split boulder (Taurus-Littrow), photographed from several sides |

## Tools and APIs

| Tool | Where |
|---|---|
| gsplat | https://github.com/nerfstudio-project/gsplat (paper: http://jmlr.org/papers/volume26/24-1476/24-1476.pdf) |
| Occam's LGS (feature lifting reference) | https://github.com/insait-institute/OccamLGS |
| CAHVOR conversion reference | https://github.com/bvnayak/CAHVOR_camera_model |
| Spark (splat renderer for three.js) | https://sparkjs.dev/docs/overview/ |
| SpacetimeDB TypeScript | https://spacetimedb.com/docs/quickstarts/typescript/ |
| Grok image editing | https://docs.x.ai/developers/model-capabilities/images/editing |
| Grok Voice Agent API | https://docs.x.ai/developers/models/voice-agent-api |
| Relay docs | https://docs.relayapp.im/llms.txt |
