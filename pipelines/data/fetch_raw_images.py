#!/usr/bin/env python3
"""Fetch Mars 2020 raw images + their JSON records (camera models) for one stop.

Survey coverage first, then download:
  python pipelines/data/fetch_raw_images.py --sols 1205 1220 --survey
  python pipelines/data/fetch_raw_images.py --sols 1205 1220 --site 56 --drive 0 --out data/raw/cheyava

Stdlib only, resumable (existing files are skipped). See docs/splat-pipeline.md step 1.
"""
import argparse
import json
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://mars.nasa.gov/rss/api/"
DEFAULT_CAMERAS = ["NAVCAM_LEFT", "NAVCAM_RIGHT", "MCZ_LEFT", "MCZ_RIGHT"]
# Hazcams (fisheye) and WATSON are opt-in: --cameras ... FRONT_HAZCAM_LEFT_A FRONT_HAZCAM_RIGHT_A
#   REAR_HAZCAM_LEFT REAR_HAZCAM_RIGHT SHERLOC_WATSON


def get(url, retries=4):
    """GET with backoff; NASA's feed drops connections under load."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pss-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(2 ** attempt)


def query(sol_min, sol_max, cameras):
    """Page through the raw-image feed, yield every record in the sol range."""
    page = 0
    while True:
        params = {
            "feed": "raw_images", "category": "mars2020", "feedtype": "json",
            "num": 100, "page": page, "order": "sol asc",
            "search": "|".join(cameras),
            "condition_2": f"{sol_min}:sol:gte", "condition_3": f"{sol_max}:sol:lte",
        }
        data = json.loads(get(API + "?" + urllib.parse.urlencode(params)))
        images = data.get("images", [])
        if not images:
            return
        yield from images
        page += 1


def ints(s):
    """'(1137,649,1296,976)' -> [1137, 649, 1296, 976]"""
    return [int(float(v)) for v in s.strip("()").split(",")]


def keep(rec, min_px):
    """Drop thumbnails and tiny subframes. Navcam full frames arrive as 1296x976
    tiles (subframeRect = tile position in the 5120x3840 sensor), so tiles are kept."""
    if rec.get("sample_type") != "Full":
        return False
    try:
        w, h = ints(rec["extended"]["dimension"])
    except (KeyError, ValueError, TypeError):
        return False
    return w >= min_px and h >= min_px


def download(rec, out):
    """Save PNG + JSON record. JSON is written last so it marks a finished pair."""
    stem = rec["imageid"]
    meta = out / f"{stem}.json"
    if meta.exists():
        return 0
    (out / f"{stem}.png").write_bytes(get(rec["image_files"]["full_res"]))
    meta.write_text(json.dumps(rec, indent=1))
    return 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sols", nargs=2, type=int, required=True, metavar=("MIN", "MAX"))
    ap.add_argument("--cameras", nargs="+", default=DEFAULT_CAMERAS)
    ap.add_argument("--site", type=int)
    ap.add_argument("--drive", nargs="+", help="one or more drive ids at that site")
    ap.add_argument("--min-px", type=int, default=600, help="skip frames smaller than this on either side")
    ap.add_argument("--survey", action="store_true", help="only print counts per sol/site/drive/camera")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    recs = [r for r in query(*args.sols, args.cameras) if keep(r, args.min_px)]
    if args.site is not None:
        recs = [r for r in recs if int(r["site"]) == args.site]
    if args.drive:
        recs = [r for r in recs if str(r["drive"]) in args.drive]
    print(f"{len(recs)} usable frames")

    counts = Counter((r["sol"], int(r["site"]), str(r["drive"]), r["camera"]["instrument"]) for r in recs)
    print(f"{'sol':>5} {'site':>4} {'drive':>6}  camera")
    for (sol, site, drive, cam), n in sorted(counts.items()):
        print(f"{sol:>5} {site:>4} {drive:>6}  {cam:<22} {n}")
    if args.survey:
        return
    if not args.out:
        ap.error("--out is required unless --survey")

    args.out.mkdir(parents=True, exist_ok=True)
    done = failed = 0
    with ThreadPoolExecutor(args.workers) as pool:
        futures = [pool.submit(download, r, args.out) for r in recs]
        for i, f in enumerate(futures, 1):
            try:
                done += f.result()
            except Exception as e:
                failed += 1
                print(f"  FAILED {recs[i - 1]['imageid']}: {e}")
            if i % 25 == 0 or i == len(futures):
                print(f"  {i}/{len(futures)}  new={done} failed={failed}")
    print(f"done: {done} new, {failed} failed -> {args.out}  (re-run to retry failures)")


if __name__ == "__main__":
    assert ints("(1137,649,1296,976)") == [1137, 649, 1296, 976]
    main()
