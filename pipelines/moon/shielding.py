"""Regolith shielding factors for the dose estimate (docs/moon-scene.md step 6, "Habitat shielding").

  uv run --no-project --with rasterio --with skyfield --with pillow --with numpy python pipelines/moon/shielding.py

Output: scenes/moon-malapert-01/shielding.json, plus the "shielding" key and one source in scene.json.

Every number below is copied from Matthiä & Berger (2024), "Radiation Exposure and Shielding Effects on the
Lunar Surface", Space Weather 22, e2024SW004095 (CC BY 4.0), read from the open-access copy at FETCHED_FROM.
Nothing is digitised from a figure and nothing is interpolated here. The only arithmetic is
  depth = areal density / regolith density      and      factor = dose behind shield / dose with no regolith.
The curve is NOT monotonic: the paper finds a minimum near 20 g/cm2 and a rise towards 90 g/cm2 as secondary
particles (neutrons) build up. Keep it that way; do not fit a smooth curve through it.

Deeper burial (metres of soil, lava tube) comes from other papers, in shielding_deep.py. Those series are written
next to `points` (points_deep, points_deep_deangelis2002, points_lava_tube) and described under `series`; they are
on different baselines and are never merged into `points`.
"""
import json

import shielding_deep
from common import BUNDLE

SOURCE_URL = "https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2024SW004095"
FETCHED_FROM = ("https://elib.dlr.de/210448/1/ME-SBA-2024-Matthi%C3%A4-Berger%20Radiation%20Exposure%20and%20"
                "Shielding%20Effects%20on%20the%20Lunar%20Surface-SPACE%20WEATHER.pdf")
SOURCE_NAME = "Matthiä & Berger (2024), Space Weather: GCR dose equivalent behind regolith shielding (shielding factors)"

# Section 2.1: "a block of regolith (density 3 g/cm3, ...)". This is the density of the paper's simulated
# regolith, and the one the paper itself uses to turn g/cm2 into cm. It is not a measured Malapert value.
DENSITY_G_CM3 = 3.0
# The paper's own conversions, for the self-check: g/cm2 -> cm ("1, 5, 10 and 20 g/cm2 (i.e., 0.33, 1.66, 3.33,
# and 6.66 cm of regolith)" and "45, 90 and 180 g/cm2 (i.e., 15, 30, and 60 cm of regolith)").
PAPER_CM = {1: 0.33, 5: 1.66, 10: 3.33, 20: 6.66, 45: 15, 90: 30, 180: 60}

# Section 3.2, running text. Whole-body dose equivalent rate in the ICRP phantom, GCR at solar minimum, mSv/d.
# (areal density g/cm2, mSv/d, how, quote)
TEXT_POINTS = [
    (0, 0.84, "stated in text, section 3.2",
     "The estimated dose equivalent rate in the unshielded scenario is 0.84 mSv/d (∼310 mSv/year)"),
    (20, 0.6, "stated in text, section 3.2; the paper says 'at around 20 g/cm2' and gives the rate to one decimal",
     "The dose equivalent rate drops and reaches a local minimum of 0.6 mSv/d (∼220 mSv/year) at around 20 g/cm2."),
    (90, 0.65, "stated in text, section 3.2",
     "At higher shielding (90 g/cm2) the dose equivalent rate increases up to 0.65 mSv/d (∼240 mSv/year)."),
    (180, 0.55, "stated in text, section 3.2",
     "For the highest shielding the absorbed dose equivalent dropped to 0.55 mSv/d (∼200 mSv/year)"),
]
# Table 2, "This work" column. A DIFFERENT quantity: effective dose equivalent rate from ICRP fluence-to-dose
# conversion coefficients, mSv/yr. Kept as its own series; the two are not merged into one curve.
# (areal density g/cm2, mSv/yr, +-, how)
TABLE2_POINTS = [
    (0, 299, 6, "table 2, rows Hayatsu et al. / Naito et al.: 'space suit only shielding without regolith'"),
    (1, 288, 6, "table 2, row Dobynde and Guo (2024), 1 g/cm2 regolith"),
    (10, 228, 4, "table 2, row Dobynde and Guo (2024), 10 g/cm2 regolith"),
    (30, 212, 3, "table 2, row Dobynde and Guo (2024), 30 g/cm2 regolith; interpolated by the paper's authors"),
    (60, 213, 2, "table 2, row Dobynde and Guo (2024), 60 g/cm2 regolith; interpolated by the paper's authors"),
]


def depth_m(areal_g_cm2, density_g_cm3=DENSITY_G_CM3):
    """Metres of regolith with the given areal density: (g/cm2) / (g/cm3) = cm."""
    return areal_g_cm2 / density_g_cm3 / 100.0


def point(areal, value, unshielded, how, **extra):
    return {"depth_m": round(depth_m(areal), 4), "factor": round(value / unshielded, 3),
            "areal_density_g_cm2": areal, "source_url": SOURCE_URL, "how": how, **extra}


def main():
    for areal, cm in PAPER_CM.items():      # self-check: our conversion gives the paper's own centimetres
        assert abs(depth_m(areal) * 100 - cm) < 0.011, (areal, cm)
    assert depth_m(180) == 0.6 and depth_m(150, 1.5) == 1.0

    points = [point(a, v, TEXT_POINTS[0][1], how, value_mSv_per_day=v, quote=q) for a, v, how, q in TEXT_POINTS]
    table2 = [point(a, v, TABLE2_POINTS[0][1], how, value_mSv_per_year=v, uncertainty_mSv_per_year=u)
              for a, v, u, how in TABLE2_POINTS]
    assert points[0]["factor"] == 1.0 and [p["factor"] for p in points[1:]] == [0.714, 0.774, 0.655]
    assert points[2]["factor"] > points[1]["factor"], "the rise between 20 and 90 g/cm2 must survive"

    out = {
        "estimate": True,
        "applies_to": "dose_estimate raster (GCR, first-order)",
        "unit_depth": f"m of regolith, converted from g/cm2 with a density of {DENSITY_G_CM3:g} g/cm3: the density of the "
                      "simulated regolith in the source paper (section 2.1), which the paper itself uses for the same "
                      "conversion. It is a modelling value, not a measured density of regolith at Malapert. "
                      "areal_density_g_cm2 is the quantity the paper reports; use it to convert with another density.",
        "density_g_cm3": DENSITY_G_CM3,
        "factor": "dose equivalent rate behind the regolith divided by the same paper's rate with no regolith (space suit only)",
        "points": points,
        "points_table2": {
            "note": "Second series from the same paper, a different dose quantity (effective dose equivalent rate from ICRP "
                    "fluence-to-dose conversion coefficients). Finer at shallow depth. Not merged into `points`.",
            "points": table2,
        },
        "source": {"citation": "Matthiä, D., & Berger, T. (2024). Radiation Exposure and Shielding Effects on the Lunar "
                               "Surface. Space Weather, 22, e2024SW004095.",
                   "url": SOURCE_URL, "doi": "10.1029/2024SW004095", "fetched_from": FETCHED_FROM, "license": "CC BY 4.0"},
        "limits": "Model result (Geant4), not a measurement. Galactic cosmic rays at solar minimum only; solar particle events "
                  "are not included. Geometry: a regolith half-sphere of 2 m inner radius over a person in a space suit "
                  "(0.5 g/cm2) standing on regolith. NOT monotonic: the dose equivalent falls to a local minimum near "
                  "20 g/cm2, rises towards 90 g/cm2 as secondary particles (neutrons) build up, and falls again by 180 g/cm2; "
                  "the paper says this maximum 'is not very well defined' because only 45, 90 and 180 g/cm2 were simulated "
                  "there. No values beyond 180 g/cm2 (0.6 m at 3 g/cm3): do not extrapolate. Straight lines between points "
                  "are our choice, not the paper's. The factor is a ratio within the paper's own model, whose unshielded "
                  "whole-body value (0.84 mSv/d) is about 1.9 times lower than the thin-detector Chang'e 4 measurement that "
                  "the dose_estimate raster is built on; multiplying that raster by the factor is a first-order estimate. "
                  "The paper notes discrepancies of up to 50% between recent models. For comparing designs, not for "
                  "medical dose planning. "
                  "DEEPER SERIES (points_deep, points_deep_deangelis2002, points_lava_tube; see `series`) come from other "
                  "papers with other dose quantities, baselines, geometries and soil densities. They are NOT on the same "
                  "baseline as `points` and must not be joined to it or to each other as one curve; each factor is relative "
                  "to that paper's own surface value. Their depth_m is not comparable with `points` either (3 g/cm3 there, "
                  "about 1.9 g/cm3 in points_deep): compare by areal_density_g_cm2 where it is given. The two deep curves "
                  "disagree strongly (at 3 m: 0.07 against 0.40 of the surface value). points_deep and "
                  "points_deep_deangelis2002 are digitised from figures.",
    }
    shielding_deep.self_check()
    deep_lists, deep_series, deep_sources = shielding_deep.build()
    out.update(deep_lists)
    out["series"] = deep_series
    (BUNDLE / "shielding.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    manifest = BUNDLE / "scene.json"
    scene = json.loads(manifest.read_text())
    scene["shielding"] = "shielding.json"
    ours = [{"name": SOURCE_NAME, "url": SOURCE_URL}] + deep_sources
    scene["sources"] = [s for s in scene["sources"] if s["name"] not in {o["name"] for o in ours}] + ours
    manifest.write_text(json.dumps(scene, indent=2, ensure_ascii=False) + "\n")
    for p in points:
        print(f"  {p['areal_density_g_cm2']:>4} g/cm2 = {p['depth_m']:.4f} m  factor {p['factor']:.3f}   ({p['how']})")
    print("  table 2 series:", [(p["depth_m"], p["factor"]) for p in table2])
    print(f"wrote {BUNDLE}/shielding.json and scene.json keys 'shielding', 'sources'")


if __name__ == "__main__":
    main()
