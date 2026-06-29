"""data/build_cube_2020.py — focused ONE-YEAR (2020) cube with REAL INSAT-3D LST.

The parallel "INSAT-3D regime" artifact (kept entirely separate from the validated
synthetic twin_cube.nc, which is untouched). It reuses the real IMD rainfall/tmax/tmin
for 2020 already in twin_cube.nc and swaps the SYNTHETIC lst channel for the REAL
INSAT-3D daily LST (one ~0600 UTC overpass/day) ingested from data/raw/insat/.

Because it is a single year, the temporal split is by MONTH (never random):
    train = Jan–Sep 2020   (must include the full monsoon to learn rainfall)
    val   = Oct 2020        (clean post-monsoon month)
    test  = Nov–Dec 2020    (held-out dry tail)
Norm stats are fit on TRAIN MONTHS ONLY (rainfall on log1p) — no leakage.

Run:  python -m data.build_cube_2020
Writes: data/twin_cube_2020.nc  +  data/norm_stats_2020.json
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg
from data.ingest_insat import ingest_h5_dir

YEAR = 2020
CUBE_2020_PATH = cfg.DATA_DIR / "twin_cube_2020.nc"
NORM_2020_PATH = cfg.DATA_DIR / "norm_stats_2020.json"

# Month-based temporal split (inclusive ISO date ranges).
SPLIT_2020 = {
    "train": ("2020-01-01", "2020-09-30"),
    "val": ("2020-10-01", "2020-10-31"),
    "test": ("2020-11-01", "2020-12-31"),
}


def compute_norm_stats_dates(ds: xr.Dataset, train_range: tuple[str, str]) -> dict:
    """Per-variable mean/std on the TRAIN MONTHS only. Rainfall on log1p."""
    t0, t1 = train_range
    train = ds.sel(time=slice(t0, t1))
    stats = {"_split_dates": SPLIT_2020, "_train_range": list(train_range)}
    norm_vars = list(cfg.VARS) + (["lst"] if "lst" in ds else [])
    for v in norm_vars:
        arr = train[v].values
        if v == "rainfall":
            arr = np.log1p(np.clip(arr, 0, None))
            transform = "log1p"
        else:
            transform = "identity"
        mean = float(np.nanmean(arr))
        std = float(np.nanstd(arr)) or 1.0
        stats[v] = {"mean": mean, "std": std, "transform": transform}
    return stats


def build() -> xr.Dataset:
    cfg.ensure_dirs()
    if not cfg.CUBE_PATH.exists():
        raise FileNotFoundError(
            f"{cfg.CUBE_PATH} not found — build the base cube first (make data-imd).")

    # 1) Real IMD rainfall/tmax/tmin (+ elevation) for 2020, sliced from the base cube.
    base = xr.open_dataset(cfg.CUBE_PATH)
    sub = base.sel(time=slice(f"{YEAR}-01-01", f"{YEAR}-12-31"))
    time_index = pd.DatetimeIndex(sub["time"].values)
    if time_index.size == 0:
        raise ValueError(f"base cube has no {YEAR} data (dates {base.time.values[0]}..{base.time.values[-1]}).")

    ds = xr.Dataset(coords={"time": sub["time"], "lat": sub["lat"], "lon": sub["lon"]})
    for v in cfg.VARS:
        ds[v] = sub[v]
    if "elevation" in base:
        elev = base["elevation"]
        ds["elevation"] = elev.sel(time=slice(f"{YEAR}-01-01", f"{YEAR}-12-31")) if "time" in elev.dims else elev

    # 2) REAL INSAT-3D daily LST (one overpass/day) -> 0.25° grid, aligned to 2020 days.
    lst = ingest_h5_dir()  # reads data/raw/insat/*.h5 ; returns (time,lat,lon) daily, °C
    if lst is None:
        raise FileNotFoundError(
            "no INSAT-3D .h5 granules in data/raw/insat/ — run the 2020 daily download first "
            "(python -m data.mosdac_client --daily --start 2020-01-01 --end 2020-12-31).")
    lst = lst.interp(lat=ds["lat"], lon=ds["lon"], method="linear")
    lst = lst.reindex(time=time_index)  # exact daily align; missing days -> NaN
    real_mask = np.isfinite(lst.values)
    coverage = float(real_mask.mean())                       # cell-level real fraction
    n_days_real = int(np.isfinite(lst.values).any(axis=(1, 2)).sum())  # days with any real LST

    # Gap-fill so the model input is finite (numpy only — avoids the bottleneck dep):
    #   (1) cloudy cells -> that day's spatial mean; (2) fully-missing days -> nearest in time.
    vals = lst.values.copy()
    for t in range(vals.shape[0]):
        day = vals[t]
        if np.isfinite(day).any():
            day[~np.isfinite(day)] = np.nanmean(day)
            vals[t] = day
    dayvalid = np.isfinite(vals).all(axis=(1, 2))
    last = None
    for t in range(vals.shape[0]):                            # forward-fill missing days
        if dayvalid[t]:
            last = vals[t].copy()
        elif last is not None:
            vals[t] = last
    nxt = None
    for t in range(vals.shape[0] - 1, -1, -1):                # back-fill any leading gap
        if np.isfinite(vals[t]).all():
            nxt = vals[t].copy()
        elif nxt is not None:
            vals[t] = nxt
    ds["lst"] = xr.DataArray(vals, coords=lst.coords, dims=lst.dims, name="lst")

    ds.attrs.update(
        region=cfg.PILOT["name"],
        bbox=json.dumps([cfg.PILOT["lon_min"], cfg.PILOT["lat_min"],
                         cfg.PILOT["lon_max"], cfg.PILOT["lat_max"]]),
        res_deg=cfg.PILOT["res_deg"],
        years=json.dumps([YEAR, YEAR]),
        variables=json.dumps(cfg.VARS),
        data_source="imd",
        data_source_note=("IMD gridded rainfall/Tmax/Tmin (2020) + REAL INSAT-3D L2B LST "
                          "(one ~0600 UTC overpass/day, MOSDAC) regridded to 0.25°."),
        lst_source="insat_real",
        lst_coverage=round(coverage, 4),
        lst_real_days=n_days_real,
        split_dates=json.dumps(SPLIT_2020),
        regime="insat_real_2020",
    )
    base.close()

    CUBE_2020_PATH.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(CUBE_2020_PATH)
    stats = compute_norm_stats_dates(ds, SPLIT_2020["train"])
    NORM_2020_PATH.write_text(json.dumps(stats, indent=2))

    print(f"[build_cube_2020] wrote {CUBE_2020_PATH}")
    print(f"[build_cube_2020]   time={ds.time.size} days  "
          f"{str(ds.time.values[0])[:10]}..{str(ds.time.values[-1])[:10]}")
    print(f"[build_cube_2020]   REAL LST days={n_days_real}/{ds.time.size}  "
          f"coverage={coverage*100:.1f}%  lst_source=insat_real")
    print(f"[build_cube_2020]   split (months): {SPLIT_2020}")
    print(f"[build_cube_2020] wrote {NORM_2020_PATH} (train months only)")
    return ds


if __name__ == "__main__":
    build()
