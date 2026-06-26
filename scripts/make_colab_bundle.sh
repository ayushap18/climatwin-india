#!/usr/bin/env bash
# make_colab_bundle.sh — zip the ClimaTwin repo for one-click upload to Google Colab.
#
# Produces climatwin_bundle.zip in the repo root, EXCLUDING heavy / machine-local
# artifacts (the .venv, raw downloads, cached cubes, checkpoints, caches, the
# frontend node_modules, git history, byte-compiled files). On Colab you upload
# this zip, unzip it, build the cube from real IMD data and train on the GPU.
#
# Usage:
#   bash scripts/make_colab_bundle.sh              # lean: build the cube on Colab
#   bash scripts/make_colab_bundle.sh --with-data  # also ship the prebuilt cube
#                                                  # (use for a real-INSAT cube built locally;
#                                                  #  the notebook then trains on it directly)
set -euo pipefail

WITH_DATA=0
[ "${1:-}" = "--with-data" ] && WITH_DATA=1

# Resolve repo root (parent of this script's dir) regardless of where it's called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

OUT="climatwin_bundle.zip"
rm -f "${OUT}"

echo "[bundle] zipping repo at ${REPO_ROOT} -> ${OUT}  (with_data=${WITH_DATA})"
zip -r -q "${OUT}" . \
  -x "*/.venv/*" ".venv/*" \
  -x "*/data/raw/*" "data/raw/*" \
  -x "data/*.nc" "*/data/*.nc" \
  -x "data/mosdac_config.json" \
  -x "*/models/checkpoints/*" "models/checkpoints/*" \
  -x "*/__pycache__/*" "__pycache__/*" \
  -x "*/node_modules/*" "node_modules/*" \
  -x "*/.git/*" ".git/*" \
  -x "*.pyc" \
  -x "*.zip"

# Optionally include a prebuilt cube (e.g. one built locally WITH real INSAT LST),
# so the notebook can skip the Colab-side build and train on the real-LST cube.
if [ "${WITH_DATA}" = "1" ]; then
  for f in data/twin_cube.nc data/norm_stats.json data/insat_lst.nc; do
    [ -f "$f" ] && zip -q "${OUT}" "$f" && echo "[bundle] +included $f"
  done
fi

echo "[bundle] done:"
ls -lh "${OUT}"
echo "[bundle] upload ${OUT} in the Colab notebook (cell 3, option b)."
