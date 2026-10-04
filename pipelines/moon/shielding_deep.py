"""Deeper-burial shielding series for shielding.json: metres of lunar soil, and a lava tube.
Imported by shielding.py; run that to regenerate. `python pipelines/moon/shielding_deep.py` runs the self-check.

Three series, three papers, three baselines. NONE is on the baseline of `points` (Matthiä & Berger 2024),
and they are not merged with it or with each other. Every factor is a ratio inside one paper.

points_deep                  Dobynde & Guo (2024), Nature Astronomy 8, 991, Fig. 1a. DIGITISED from the figure image
                             Nature serves publicly (the article text is paywalled and was not read).
points_deep_deangelis2002    De Angelis et al. (2002), J. Radiat. Res. 43, S41, Fig. 3. DIGITISED. Older method.
points_lava_tube             Naito et al. (2020), J. Radiol. Prot. 40, 947. Stated in the text.

How the figures were read (pixels of the published image, linear axes, frame lines as the axis limits):
  Dobynde & Guo Fig. 1a, 1512 x 1492 px: frame x 88..701 px = 0..50 cSv/yr, y 88..704 px = 0..3 m. Right-most
    pixel of the blue "Total" band in a row = solar minimum (caption). Read on the rows of the figure's own red
    dotted column-mass lines (100..500 g/cm2), so depth and g/cm2 both come from the figure's axes.
    Reading error +-0.3 cSv/yr (+-3 px), +-0.01 m.
  De Angelis Fig. 3, 3307 x 2504 px: frame x 441..3229.5 px = 0..10 m, y 2270.5..35.5 px = 0..0.3 Sv/yr. The
    "TOTAL DOSE" curve is straight segments with a vertex every 0.5 m; vertices read. Error +-0.002 Sv/yr.
"""

DG_URL = "https://www.nature.com/articles/s41550-024-02287-8/figures/1"
DG_QUOTE = ("Fig. 1: Dependence of the effective dose rate on the lunar soil depth for spacesuits and bases with different "
            "Al shielding thicknesses. a, 1 g cm−2 [...] The coloured bands cover the range of results between the solar "
            "minimum in 2020 (the right edge) and the solar maximum in 2014 (the left edge) of solar cycle 24.")
# (depth m, accumulated column mass g/cm2 from the figure's right axis or None, Total at solar minimum, cSv/yr)
DG_POINTS = [(0.0, 0, 41.1), (0.52, 100, 36.9), (1.04, 200, 24.2), (1.60, 300, 13.8), (2.16, 400, 7.5),
             (2.72, 500, 4.0), (3.0, None, 2.9)]
DG_CHECK_MSV = 411     # Matthiä & Berger (2024) Table 2 quote the same figure's surface value as 411 mSv/yr

DEA_URL = "https://doi.org/10.1269/jrr.43.s41"
DEA_QUOTE = "Fig. 3. Results for Effective Dose (E) inside a lava tube"
# (depth m, TOTAL DOSE effective dose, Sv/yr)
DEA_POINTS = [(0.0, 0.273), (0.5, 0.297), (1.0, 0.273), (1.5, 0.233), (2.0, 0.187), (2.5, 0.144), (3.0, 0.108),
              (3.5, 0.079), (4.0, 0.056), (4.5, 0.032), (5.0, 0.0175), (5.5, 0.006), (6.0, 0.002)]
DEA_CHECK_PEAK = 0.297  # stated in the text: "E=0.297 Sv/yr at the point of the maximum dose rate"

NAITO_URL = "https://iopscience.iop.org/article/10.1088/1361-6498/abb120"
NAITO_SURFACE_MSV = 416.0


def _pt(depth, factor, areal, url, how, quote, **extra):
    return {"depth_m": depth, "factor": round(factor, 4 if factor < 0.01 else 3), "areal_density_g_cm2": areal,
            "source_url": url, "how": how, "quote": quote, **extra}


def build():
    """Returns (lists keyed by series name, metadata keyed by series name, sources for scene.json)."""
    dg = [_pt(d, v / DG_POINTS[0][2], a, DG_URL, "digitised from figure 1a, right edge of the Total band; "
              "+-0.3 cSv/yr, so factor +-0.01" + ("" if a is not None else "; bottom of the axis, column mass not labelled"),
              DG_QUOTE, value_cSv_per_year=v) for d, a, v in DG_POINTS]
    dea = [_pt(d, v / DEA_POINTS[0][1], None, DEA_URL, "digitised from figure 3, TOTAL DOSE curve; +-0.002 Sv/yr, so factor +-0.01"
               + ("; this value is also stated in the text" if v == DEA_CHECK_PEAK else ""), DEA_QUOTE, value_Sv_per_year=v)
           for d, v in DEA_POINTS]
    naito = [
        _pt(0.0, 1.0, 0, NAITO_URL, "stated in text, section 3.1.1 and table 2",
            "The effective dose equivalents in solar minimum and maximum phases were 416.0 mSv yr−1 and 160.5 mSv yr−1, respectively.",
            value_mSv_per_year=NAITO_SURFACE_MSV, place="lunar surface"),
        _pt(43.0, 1 / 20, None, NAITO_URL, "stated in text, section 3.2 ('a factor of 20'); the abstract says 'below 30 mSv yr−1'",
            "The effective dose equivalent at the bottom of the vertical hole decreased by a factor of 20 comparing to that at the lunar surface.",
            place="bottom of an OPEN vertical hole, 25 m radius, 43 m deep: no roof, the reduction is from the smaller patch of sky"),
        _pt(43.0, 1.0 / NAITO_SURFACE_MSV, None, NAITO_URL, "stated in text, section 3.2, as an upper limit: 1.0 / 416.0",
            "If there is a space exceeding 50 m, 75 m from the hole center, the effective dose equivalent becomes less than 1.0 mSv yr−1.",
            value_mSv_per_year=1.0, factor_is_upper_bound=True,
            place="inside the horizontal lava tube, at least 75 m from the centre of the hole; tube floor 43 m below the surface"),
    ]
    lists = {"points_deep": dg, "points_deep_deangelis2002": dea, "points_lava_tube": naito}
    series = {
        "points_deep": {
            "source": {"citation": "Dobynde, M., & Guo, J. (2024). Guidelines for radiation-safe human activities on the Moon. "
                                   "Nature Astronomy, 8, 991–999.", "url": DG_URL, "doi": "10.1038/s41550-024-02287-8"},
            "quantity": "effective dose rate (the figure's label: 'Effective dose (cSv yr−1)')",
            "radiation": "galactic cosmic rays, Z = 1 to 28, solar minimum 2020 (right edge of the band)",
            "baseline": "the same figure's value at depth 0 behind 1 g/cm2 of aluminium: 41.1 cSv/yr",
            "geometry": "depth below a flat lunar surface ('Depth in the lunar soil'), 1 g/cm2 Al extra shielding (panel a)",
            "density": "not stated in what was opened. The figure's own 'Accumulated column mass' axis puts 100 g/cm2 at 0.52 m and "
                       "500 g/cm2 at 2.72 m, i.e. a mean of about 1.9 g/cm3",
            "note": "Digitised, not tabulated. Only the abstract, this figure and its caption were read; the article is paywalled. "
                    "The abstract says the exposure 'can even slightly increase beneath the surface before it decreases to a "
                    "negligible value at about 3 m depth'; the figure still shows about 2.9 cSv/yr (7% of the surface value) at 3 m. "
                    "The figure ends at 3 m: do not extrapolate.",
        },
        "points_deep_deangelis2002": {
            "source": {"citation": "De Angelis, G., Wilson, J. W., Clowdsley, M. S., Nealy, J. E., Humes, D. H., & Clem, J. M. (2002). "
                                   "Lunar Lava Tube Radiation Safety Analysis. J. Radiat. Res., 43, S41–S45.", "url": DEA_URL,
                       "doi": "10.1269/jrr.43.s41", "fetched_from": "https://www.jstage.jst.go.jp/article/jrr/43/S/43_S_S41/_pdf"},
            "quantity": "Effective Dose E from fluence conversion coefficients (ICRP 60 radiation weighting factors)",
            "radiation": "galactic cosmic rays, solar minimum (510 MV); nuclei heavier than protons transported as individual nucleons",
            "baseline": "the same curve's value at depth 0: 0.273 Sv/yr (digitised)",
            "geometry": "depth below a flat surface: 5 m of regolith over rock (roof thickness of a lava tube)",
            "density": "regolith density profile from the paper's reference 7, not given numerically; rock 3.3 g/cm3. "
                       "So g/cm2 is unknown for these points",
            "note": "Older model (FLUKA, 2002). The paper says 'After 6 m of depth, no effects of radiation due to or induced by GCRs "
                    "are observable in the simulation'. It disagrees with points_deep: at 3 m this curve is at 0.40 of its surface "
                    "value, Dobynde & Guo at 0.07. In this model the dose RISES over the first 0.5 m (factor 1.09).",
        },
        "points_lava_tube": {
            "source": {"citation": "Naito, M., Hasebe, N., Shikishima, M., Amano, Y., Haruyama, J., Matias-Lopes, J. A., Kim, K. J., & "
                                   "Kodaira, S. (2020). Radiation dose and its protection in the Moon from galactic cosmic rays and "
                                   "solar energetic particles: at the lunar surface and in a lava tube. J. Radiol. Prot., 40, 947–961.",
                       "url": NAITO_URL, "doi": "10.1088/1361-6498/abb120"},
            "quantity": "effective dose equivalent",
            "radiation": "galactic cosmic rays, solar minimum",
            "baseline": "the same paper's value on the open lunar surface: 416.0 mSv/yr",
            "geometry": "Marius Hills hole: vertical hole of 25 m radius and 43 m depth opening into a horizontal lava tube of 17 m "
                        "cavern radius. These are places, not a depth curve: depth_m is the depth of the floor, not a cover thickness",
            "density": "'The density of the lunar surface was set to 2.0 g cm−3 assuming regolith, and that of the lava tube was set to 3.1 g cm−3'",
            "note": "The lava tube value is an upper limit ('less than 1.0 mSv yr−1'), flagged factor_is_upper_bound.",
        },
    }
    sources = [{"name": f"Shielding, {k}: {v['source']['citation'].split(').')[0]})", "url": v["source"]["url"]}
               for k, v in series.items()]
    return lists, series, sources


def self_check():
    lists, series, sources = build()
    assert abs(DG_POINTS[0][2] * 10 - DG_CHECK_MSV) < 3, "surface reading differs from the value Matthiä & Berger quote for this figure"
    assert max(v for _, v in DEA_POINTS) == DEA_CHECK_PEAK, "digitised peak differs from the value stated in the paper's text"
    for d, a, _ in DG_POINTS[1:-1]:                       # the figure's two axes imply a plausible soil density
        assert 1.7 < a / (d * 100) < 2.0, (d, a)
    for name in ("points_deep", "points_deep_deangelis2002"):
        pts = lists[name]
        assert pts[0]["depth_m"] == 0 and pts[0]["factor"] == 1.0
        assert all(a["depth_m"] < b["depth_m"] for a, b in zip(pts, pts[1:]))
        deep = [p["factor"] for p in pts if p["depth_m"] >= 1.0]
        assert deep == sorted(deep, reverse=True), name   # both fall steadily below 1 m
    assert lists["points_deep"][-1]["factor"] == 0.071 and lists["points_deep_deangelis2002"][1]["factor"] == 1.088
    assert lists["points_lava_tube"][1]["factor"] == 0.05 and lists["points_lava_tube"][2]["factor"] == 0.0024
    assert set(lists) == set(series) and len(sources) == 3
    need = {"depth_m", "factor", "areal_density_g_cm2", "quote", "source_url", "how"}
    assert all(need <= set(p) for pts in lists.values() for p in pts)
    print("ok: deep shielding series", {k: [(p["depth_m"], p["factor"]) for p in v] for k, v in lists.items()})


if __name__ == "__main__":
    self_check()
