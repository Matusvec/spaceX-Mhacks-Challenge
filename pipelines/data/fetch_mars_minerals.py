#!/usr/bin/env python3
"""Orbital mineralogy for the Mars scene as terrain rasters (docs/contracts.md section 5). Area-level only.

  python3 pipelines/data/fetch_mars_minerals.py scenes/mars-hero-01
  python3 pipelines/data/fetch_mars_minerals.py --self-check

Two georeferenced products touch the scene's terrain window, and neither reaches the rover site at its centre:
  1. CRISM spectral summary parameters, observation FRT00005C5E (PDS MTRDR, 18 m/px): the east edge.
     Only the bands used are fetched, by HTTP range (3.2 MB each out of 190 MB). The PDS map placement is
     about 300 m off the HiRISE basemap, so the product is first shifted to match the scene's orthophoto.
  2. Jezero western rim mineral unit map (Valantinas et al., Zenodo, 18 m/px classes): the west corners.
     Its authors registered it to the Mars 2020 basemap already; it is used as published.
Each raster has the extent and orientation of terrain.png. It is 8-bit grey plus alpha: alpha 0 means the
product has no data there. Nothing is interpolated into the gaps, and source pixels are kept as blocks.
"""
import io
import json
import math
import re
import sys
import time
import urllib.request
import zipfile
from itertools import product
from pathlib import Path

import numpy as np
from PIL import Image

R_MARS = 3396190.0     # sphere of the terrain's equirectangular map (scene.json map_crs)
TERRAIN_PX = 2000      # the terrain window: this many DTM pixels square (fetch_mars_terrain.py SIZE_M)
OUT_PX = 500           # 4 map units per pixel, so an 18 m source pixel stays a visible block
MATCH_BAND = "R1330"   # CRISM brightness at 1.33 microns, matched against the orthophoto to register the product
MATCH_PX = 222         # the window at 9 m per pixel for that match
MATCH_SEARCH = 25      # CRISM pixels each way (450 m)
MATCH_MIN_CORR = 0.3   # below this the product is left where PDS put it, and the layer says so
PDS = ("https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/mtrdr/2007/2007_139/"
       "frt00005c5e/frt00005c5e_07_sr166j_mtr3")
PARAMETERS_DOI = "https://doi.org/10.1002/2014JE004627"   # Viviano-Beck et al. 2014, defines the parameters
ZENODO = "https://zenodo.org/records/22257754"
ZENODO_ZIP = "https://zenodo.org/api/records/22257754/files/jezero_rim_maps_v1_core.zip/content"
UNIT_MAP = "jezero_rim_maps_v1/01_geologic_map/geologic_map_CRISM_CaSSIS.tif"
UNIT_NAMES = "jezero_rim_maps_v1/01_geologic_map/class_dictionary.csv"
# CRISM band name -> (raster name, unit, what the number means). Wording follows the parameter definitions.
CRISM_BANDS = {
    "OLINDEX3": ("crism_olivine_index", "index (dimensionless)",
                 "CRISM summary parameter OLINDEX3: strength of the broad 1 micron absorption of olivine. Higher "
                 "means a stronger olivine signature. It is not an abundance."),
    "BD2500_2": ("crism_carbonate_bd2500", "band depth (dimensionless)",
                 "CRISM summary parameter BD2500_2: depth of the 2.5 micron absorption used as a carbonate indicator. "
                 "Values near or below zero mean no detectable band. It is not an abundance. The colour ramp spans only "
                 "this strip's own narrow range, so a light cell is not a detection."),
}
SOURCES = [
    {"name": "CRISM MTRDR FRT00005C5E refined spectral summary parameters, 18 m/px (NASA PDS Geosciences Node)",
     "url": PDS + ".lbl"},
    {"name": "Jezero Western Rim Mineral Maps, Valantinas et al. (Zenodo, CC BY 4.0), 18 m/px", "url": ZENODO},
]


def fetch(url, first=None, last=None):
    """GET a URL, or bytes first..last of it. Retries: this network drops connections."""
    request = urllib.request.Request(url, headers={"Range": f"bytes={first}-{last}"} if first is not None else {})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                data = response.read()
            if first is None or len(data) == last - first + 1:
                return data
        except OSError as error:
            print(f"  retry {attempt + 1}: {error}")
        time.sleep(3)
    raise SystemExit(f"could not fetch {url}")


def window_lonlat(origin, out_px=OUT_PX):
    """Longitude and latitude (radians) of each output pixel centre; row 0 is north, like terrain.png.

    The terrain window is TERRAIN_PX whole DTM pixels around the pixel that holds the site origin, and the
    DTM grid sits on whole map metres, so its edges are whole numbers. Map x = R lon, y = R lat (lat_ts=0).
    """
    west, north = math.floor(origin["x"]) - TERRAIN_PX // 2, math.ceil(origin["y"]) + TERRAIN_PX // 2
    step = TERRAIN_PX / out_px
    x = west + (np.arange(out_px) + 0.5) * step
    y = north - (np.arange(out_px) + 0.5) * step
    return np.meshgrid(x / R_MARS, y / R_MARS)


def parse_envi(header):
    """Size, bands and map placement out of an ENVI .hdr of a CRISM MTRDR (equirectangular, own sphere)."""
    def number(key):
        return float(re.search(rf"^{key}\s*=\s*([\d.eE+-]+)", header, re.M).group(1))
    info = re.search(r"map info = \{(.*?)\}", header).group(1).split(",")
    projection = re.search(r"projection info = \{(.*?)\}", header).group(1).split(",")
    return {"samples": int(number("samples")), "lines": int(number("lines")), "nodata": number("data ignore value"),
            "bands": [b.strip() for b in re.search(r"band names = \{(.*?)\}", header, re.S).group(1).split(",")],
            "west_m": float(info[3]), "north_m": float(info[4]), "pixel_m": float(info[5]),   # corner of pixel (1, 1)
            "radius_m": float(projection[1]), "lat_ts_deg": float(projection[2])}


def crism_pixel(h, lon, lat):
    """Column and row of the CRISM pixel that holds each lon/lat (radians): x = R cos(lat_ts) lon, y = R lat."""
    col = (h["radius_m"] * math.cos(math.radians(h["lat_ts_deg"])) * lon - h["west_m"]) / h["pixel_m"]
    row = (h["north_m"] - h["radius_m"] * lat) / h["pixel_m"]
    return np.floor(col).astype(int), np.floor(row).astype(int)


def lookup(grid, col, row, nodata):
    """Nearest source pixel for each output pixel; returns values and which of them hold data."""
    inside = (col >= 0) & (col < grid.shape[1]) & (row >= 0) & (row < grid.shape[0])
    values = grid[row.clip(0, grid.shape[0] - 1), col.clip(0, grid.shape[1] - 1)]
    return values, inside & (values != nodata)


def best_shift(grid, col, row, grey, nodata):
    """Whole-pixel shift (columns, rows) of the CRISM grid that best correlates it with the orthophoto.

    Returns the shift, its correlation and the correlation with no shift. A shift at the edge of the
    search is not a peak, so it is refused."""
    scores = {}
    for dx, dy in product(range(-MATCH_SEARCH, MATCH_SEARCH + 1), repeat=2):
        values, ok = lookup(grid, col + dx, row + dy, nodata)
        if ok.sum() >= ok.size / 20:
            scores[dx, dy] = float(np.corrcoef(grey[ok], values[ok])[0, 1])
    best = max(scores, key=scores.get)
    if scores[best] < MATCH_MIN_CORR or MATCH_SEARCH in map(abs, best):
        best = (0, 0)
    return best, scores[best], scores.get((0, 0))


def write_raster(path, values, valid):
    """8-bit grey + alpha PNG: value = low + pixel / 255 * (high - low) where alpha is 255; alpha 0 is no data."""
    low, high = float(values[valid].min()), float(values[valid].max())
    pixel = np.where(valid, np.round((values - low) / ((high - low) or 1) * 255), 0).astype(np.uint8)
    Image.fromarray(np.dstack([pixel, np.where(valid, 255, 0).astype(np.uint8)]), "LA").save(path, "PNG")
    return low, high


def entry(name, low, high, unit, source, url, resolution, description, valid):
    covered = round(100 * float(valid.mean()), 1)
    return {"name": name, "file": name + ".png", "bits": 8, "min": round(low, 4), "max": round(high, 4), "unit": unit,
            "source": source, "source_url": url, "resolution": resolution, "estimate": False,
            "nodata": "alpha 0 in the PNG", "coverage_pct": covered,
            "description": f"{description} Covers {covered}% of this terrain window and not the rover site; "
                           "the rest has no data, which is not the same as a low value."}


def crism_layers(out, origin, ortho):
    h = parse_envi(fetch(PDS + ".hdr").decode())
    band_bytes = h["samples"] * h["lines"] * 4            # band-sequential 32-bit floats, no file header

    def band(name):
        k = h["bands"].index(name)
        print(f"reading CRISM band {name} ({band_bytes / 1e6:.1f} MB) ...")
        data = fetch(PDS + ".img", k * band_bytes, (k + 1) * band_bytes - 1)
        return np.frombuffer(data, "<f4").reshape(h["lines"], h["samples"])
    grey = np.asarray(Image.open(ortho).convert("L").resize((MATCH_PX, MATCH_PX), Image.BOX), float)
    col, row = crism_pixel(h, *window_lonlat(origin, MATCH_PX))
    (dx, dy), corr, corr_before = best_shift(band(MATCH_BAND), col, row, grey, h["nodata"])
    east, north = -dx * h["pixel_m"], dy * h["pixel_m"]     # the picture moves opposite to the lookup
    placed = (f"moved {abs(east):.0f} m {'east' if east > 0 else 'west'} and {abs(north):.0f} m "
              f"{'north' if north > 0 else 'south'} to match the HiRISE orthophoto (brightness correlation {corr:.2f}, "
              f"{corr_before:.2f} as placed by PDS; whole-pixel fit)" if (dx, dy) != (0, 0) else
              "as map-projected by PDS; no shift could be fitted to the HiRISE orthophoto, so placement is unchecked")
    print(f"CRISM {MATCH_BAND} against {ortho.name}: {placed}")
    col, row = crism_pixel(h, *window_lonlat(origin))
    for name, (raster, unit, meaning) in CRISM_BANDS.items():
        values, valid = lookup(band(name), col + dx, row + dy, h["nodata"])
        low, high = write_raster(out / f"{raster}.png", values, valid)
        yield entry(raster, low, high, unit,
                    f"CRISM MTRDR FRT00005C5E_07_SR166J_MTR3, band {name} (NASA PDS Geosciences Node); parameter "
                    f"defined in Viviano-Beck et al. 2014, {PARAMETERS_DOI}", PDS + ".lbl",
                    f"orbital, {h['pixel_m']:g} m/px; {placed}",
                    f"{meaning} Median over the covered cells: {np.median(values[valid]):.4f}.", valid)


def unit_layers(out, lon, lat):
    print("reading the Zenodo unit map (1.3 MB) ...")
    archive = zipfile.ZipFile(io.BytesIO(fetch(ZENODO_ZIP)))
    image = Image.open(io.BytesIO(archive.read(UNIT_MAP)))
    degrees_per_px, (_, _, _, west, north, _) = image.tag_v2[33550][0], image.tag_v2[33922]   # geographic GeoTIFF
    col = np.floor((np.degrees(lon) - west) / degrees_per_px).astype(int)
    row = np.floor((north - np.degrees(lat)) / degrees_per_px).astype(int)
    classes, mapped = lookup(np.asarray(image), col, row, 0)
    pixel_m = math.radians(degrees_per_px) * R_MARS
    for line in archive.read(UNIT_NAMES).decode().splitlines()[1:]:
        value, interp, display = [field.strip('"') for field in re.split(r',(?=(?:[^"]*"[^"]*")*[^"]*$)', line)[:3]]
        here = mapped & (classes == int(value))
        if not here.any():
            continue
        name = "unit_" + re.sub(r"[^a-z0-9]+", "_", display.lower()).strip("_")
        write_raster(out / f"{name}.png", here.astype(float), mapped)
        yield entry(name, 0.0, 1.0, "1 = mapped as this unit, 0 = mapped as another unit",
                    "Jezero Western Rim Mineral Maps (CRISM + CaSSIS/HiRISE), Valantinas et al., Zenodo "
                    "doi:10.5281/zenodo.22257754, geologic_map_CRISM_CaSSIS.tif; companion paper in revision", ZENODO,
                    f"orbital, {pixel_m:.0f} m/px unit map; its authors give 28 to 85 m geolocation error",
                    f'Mineral unit "{display}" (the dataset\'s spectral interpretation: "{interp}"), '
                    f"{100 * here.sum() / mapped.sum():.0f}% of the mapped part of this window. Units name the "
                    "dominant absorber in CRISM spectra, not modal abundance.", mapped)


def main(bundle):
    manifest = bundle / "scene.json"
    scene = json.loads(manifest.read_text())
    out = bundle / "rasters"
    out.mkdir(exist_ok=True)
    grey = bundle / "terrain_texture_gray.jpg"          # the untinted orthophoto, when tint_terrain.py has run
    ortho = grey if grey.exists() else bundle / scene["terrain"]["texture"]
    new = [*crism_layers(out, scene["site_origin_map"], ortho), *unit_layers(out, *window_lonlat(scene["site_origin_map"]))]
    index = out / "index.json"
    old = json.loads(index.read_text()) if index.exists() else []
    names = {e["name"] for e in new}
    index.write_text(json.dumps([e for e in old if e["name"] not in names] + new, indent=2) + "\n")
    for e in new:
        print(f"  {e['name']}: {e['min']} .. {e['max']} {e['unit']}, covers {e['coverage_pct']}%")

    scene = json.loads(manifest.read_text())    # again: other steps write this file too
    known = {s["url"] for s in scene["sources"]}
    scene["sources"] += [s for s in SOURCES if s["url"] not in known]
    manifest.write_text(json.dumps(scene, indent=2) + "\n")
    if scene.get("rasters") != "rasters/index.json":
        print('NOTE: scene.json has no "rasters": "rasters/index.json" yet; the viewer needs it to list these.')


def self_check():
    """The window is the terrain crop, the CRISM projection matches its PDS label, and a raster decodes back."""
    lon, lat = window_lonlat({"x": 4582241.806986198, "y": 1096432.7951230633}, out_px=TERRAIN_PX)
    # data/terrain/mars-hero-01/dtm.tif starts at map (4581241, 1097433): its first pixel centre is half a pixel in
    assert abs(lon[0, 0] * R_MARS - 4581241.5) < 1e-6 and abs(lat[0, 0] * R_MARS - 1097432.5) < 1e-6
    assert lat[0, 0] > lat[-1, 0] and lon[0, 0] < lon[0, -1]                       # row 0 north, column 0 west
    # FRT00005C5E: the ENVI corner must be the label's WESTERNMOST_LONGITUDE and MAXIMUM_LATITUDE
    h = {"west_m": 4422849.2, "north_m": 1104156.6, "pixel_m": 18.0, "radius_m": 3394839.813316312, "lat_ts_deg": 15.0}
    corners = np.radians([[77.2791950 + 1e-4, 77.5587930 - 1e-4], [18.6350470 - 1e-4, 18.3646720 + 1e-4]])
    col, row = crism_pixel(h, *corners)
    assert (col.tolist(), row.tolist()) == ([0, 889], [0, 890]), (col, row)        # the product is 890 x 891
    values, valid = np.array([[0.05, 0.12], [0.08, 9.0]]), np.array([[True, True], [True, False]])
    buffer = io.BytesIO()
    low, high = write_raster(buffer, values, valid)
    back = np.asarray(Image.open(buffer)).astype(float)
    assert (low, high) == (0.05, 0.12) and (back[..., 1] == valid * 255).all()     # the 9.0 is no data, not the max
    assert np.abs(low + back[..., 0] / 255 * (high - low) - values)[valid].max() <= (high - low) / 510 + 1e-12
    got, ok = lookup(np.arange(12.0).reshape(3, 4), np.array([0, 3, 4, -1]), np.array([0, 2, 1, 1]), 11.0)
    assert got[0] == 0 and ok.tolist() == [True, False, False, False]              # 11 is no data; two are outside
    scene = np.random.default_rng(0).random((120, 120))                            # a picture displaced by (7, -4)
    row, col = np.mgrid[40:80, 40:80]
    assert best_shift(scene, col, row, scene[row - 4, col + 7], -1.0)[0] == (7, -4)
    print("self-check ok")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    self_check() if sys.argv[1] == "--self-check" else main(Path(sys.argv[1]))
