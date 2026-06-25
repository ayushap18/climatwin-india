#!/usr/bin/env bash
# make_colab_bundle.sh — zip the ClimaTwin repo for one-click upload to Google Colab.
#
# Produces climatwin_bundle.zip in the repo root, EXCLUDING heavy / machine-local
# artifacts (the .venv, raw downloads, cached cubes, checkpoints, caches, the
# frontend node_modules, git history, byte-compiled files). On Colab you upload
# this zip, unzip it, build the cube from real IMD data and train on the GPU.
#
# Usage:
#   bash scripts/make_colab_bundle.sh
set -euo pipefail

# Resolve repo root (parent of this script's dir) regardless of where it's called from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

OUT="climatwin_bundle.zip"
rm -f "${OUT}"

echo "[bundle] zipping repo at ${REPO_ROOT} -> ${OUT}"
zip -r -q "${OUT}" . \
  -x "*/.venv/*" ".venv/*" \
  -x "*/data/raw/*" "data/raw/*" \
  -x "data/*.nc" "*/data/*.nc" \
  -x "*/models/checkpoints/*" "models/checkpoints/*" \
  -x "*/__pycache__/*" "__pycache__/*" \
  -x "*/node_modules/*" "node_modules/*" \
  -x "*/.git/*" ".git/*" \
  -x "*.pyc" \
  -x "${OUT}"

echo "[bundle] done:"
ls -lh "${OUT}"
echo "[bundle] upload ${OUT} in the Colab notebook (cell 3, option b)."
