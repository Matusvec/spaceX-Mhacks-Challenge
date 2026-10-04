#!/usr/bin/env bash
# Malapert Massif (LOLA Site 23) terrain + ephemeris files. Resumable: re-run to continue.
# Sources: docs/data-sources.md. Output: data/moon/
set -u
mkdir -p data/moon && cd data/moon
get() { curl -fL -C - --retry 5 --retry-delay 3 -sS -o "$(basename "$1")" "$1" && echo "ok $(basename "$1")" || echo "FAILED $1"; }

LOLA=https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site23
get $LOLA/Site23_final_adj_5mpp_surf.tif     # 5 m/px height, south polar stereographic m, MOON_ME
get $LOLA/Site23_final_adj_5mpp_slp.tif      # 5 m/px slope (deg)
get $LOLA/Site23_final_adj_5mpp_toterr.tif   # height uncertainty (m)
# far-field horizon for sunlight and Earth visibility: whole cap to 80S at 80 m/px
get https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF

# Sun/Earth positions in the Moon frame (skyfield)
get https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de421.bsp
NAIF=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
get $NAIF/fk/satellites/moon_080317.tf
get $NAIF/pck/a_old_versions/pck00008.tpc
get $NAIF/pck/moon_pa_de421_1900-2050.bpc
