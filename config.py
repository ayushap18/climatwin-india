"""config.py — single source of truth for ClimaTwin India.

Changing PILOT here rebuilds the whole cube/model/dashboard for a new region with
NO code edits — that is the "scalable to national" deliverable (CLAUDE.md §2.6).
"""
from __future__ import annotations

from pathlib import Path

# --------------------------------------------------------------------------- #
# Pilot region (locked scope: ONE region, TWO variables, short-term).
# Delhi-NCR box — wider than Delhi proper so the spatial model has extent
# (Delhi at 0.25° is only ~2x2 cells). See CLAUDE.md §1.
# --------------------------------------------------------------------------- #
PILOT = {
    "name": "Delhi-NCR",
    "lat_min": 27.5,
    "lat_max": 29.5,
    "lon_min": 75.5,
    "lon_max": 78.5,
    "res_deg": 0.25,
    "years": (2000, 2023),  # recent decades for PoC speed
}

# Temporal split ONLY — never random-split a time series (CLAUDE.md §2.4).
# (start_year, end_year) inclusive.
SPLIT = {
    "train": (2000, 2018),
    "val": (2019, 2021),
    "test": (2022, 2023),
}

# Dynamic forecast channels and their fixed order in the (C, H, W) state tensor.
VARS = ["rainfall", "tmax", "tmin"]
RAIN, TMAX, TMIN = 0, 1, 2  # channel indices into the state
UNITS = {"rainfall": "mm", "tmax": "degC", "tmin": "degC", "elevation": "m"}

# Model windowing.
K_INPUT = 7      # input history length (days)
H_HORIZON = 7    # default forecast horizon (days)
MAX_HORIZON = 14 # hard ceiling on requested forecast horizon (API + agents)

# The day the dashboard LANDS on by default — a curated, meteorologically *active* day
# (a monsoon day: real rainfall + warmth) so the demo never opens on a dead winter date.
# Users can still scrub to any date up to dates.end. Falls back to the last date if absent.
FEATURED_DATE = "2023-08-23"

# Rainfall thresholds / impact parameters (explainable, simple — CLAUDE.md §8).
RAIN_WET_DAY_MM = 2.5       # rain/no-rain threshold for categorical skill
HEAT_STRESS_TMAX_C = 40.0   # heat-stress flag
SOWING_ONSET_MM = 20.0      # accumulated rainfall onset for sowing window

# Assimilation nudging strength (simplified scheme — CLAUDE.md §8).
ASSIMILATION_ALPHA = 0.6

# --------------------------------------------------------------------------- #
# Paths (everything relative to repo root so the demo is portable/offline).
# --------------------------------------------------------------------------- #
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"               # downloaded IMD .grd cache
CUBE_PATH = DATA_DIR / "twin_cube.nc"    # canonical artifact
NORM_STATS_PATH = DATA_DIR / "norm_stats.json"  # train-years-only stats
MODELS_DIR = ROOT / "models"
CKPT_DIR = MODELS_DIR / "checkpoints"
METRICS_PATH = MODELS_DIR / "validation_metrics.json"


def grid_axes():
    """Return (lats, lons) 1-D arrays for the pilot grid, south->north / west->east."""
    import numpy as np

    res = PILOT["res_deg"]
    lats = np.round(np.arange(PILOT["lat_min"], PILOT["lat_max"] + res / 2, res), 4)
    lons = np.round(np.arange(PILOT["lon_min"], PILOT["lon_max"] + res / 2, res), 4)
    return lats, lons


def ensure_dirs():
    for d in (DATA_DIR, RAW_DIR, CKPT_DIR):
        d.mkdir(parents=True, exist_ok=True)
