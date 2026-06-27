"""data/build_cube.py — build & cache the canonical twin_cube.nc.

Two sources:
  * ``imd``       — real IMD gridded rainfall (0.25 deg) + Tmax/Tmin (1 deg) via imdlib,
                    clipped to the pilot bbox and the temperature regridded to 0.25 deg.
                    See files/data_access.md for verified product/grid details.
  * ``synthetic`` — physically-plausible offline data so the twin + demo run with NO
                    network. Clearly tagged ``data_source="synthetic"`` (honesty, CLAUDE.md §2.8).

``auto`` (default) tries IMD, falls back to synthetic if imdlib/network is unavailable.

The cube: dims (time, lat, lon); vars rainfall(mm), tmax(degC), tmin(degC),
elevation(m, static); ONE common 0.25 deg grid over the pilot bbox; ocean cells N/A
(Delhi-NCR is inland, so none here). norm_stats.json is computed on TRAIN YEARS ONLY
(no leakage, CLAUDE.md §2.5) and written beside the cube.

Run:  python -m data.build_cube [--source auto|imd|synthetic] [--seed 0]
"""
from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg


# --------------------------------------------------------------------------- #
# Synthetic generator (offline fallback) — plausible Delhi-NCR climatology.
# --------------------------------------------------------------------------- #
def make_synthetic(seed: int = 0) -> xr.Dataset:
    """Generate a plausible (NOT real) Delhi-NCR daily cube for 2000..2023.

    Encodes: annual temperature cycle (hot May-Jun, cool Jan), SW monsoon rainfall
    (Jul-Sep), an elevation/latitude lapse gradient, AR(1) day-to-day persistence
    (so the persistence baseline is meaningful) and zero-inflated rainfall.
    """
    rng = np.random.default_rng(seed)
    lats, lons = cfg.grid_axes()
    H, W = lats.size, lons.size
    y0, y1 = cfg.PILOT["years"]
    time = pd.date_range(f"{y0}-01-01", f"{y1}-12-31", freq="D")
    T = len(time)
    doy = time.dayofyear.to_numpy()

    # Static elevation: gentle plain (~210 m) rising toward the NW (Aravalli edge).
    latg, long = np.meshgrid(lats, lons, indexing="ij")  # (H, W)
    elevation = (
        210.0
        + 8.0 * (latg - lats.mean())
        - 6.0 * (long - lons.mean())
        + rng.normal(0, 4, size=(H, W))
    ).astype("float32")
    lapse = 0.0065 * (elevation - elevation.mean())  # deg C cooling vs grid mean

    # --- Temperature: seasonal cycle + spatial lapse + AR(1) noise ----------
    # Tmax peaks ~mid-June (doy~165), trough ~mid-Jan.
    seas_tmax = 32.5 + 8.5 * np.cos(2 * np.pi * (doy - 165) / 365.25)
    seas_tmin = 18.0 + 9.0 * np.cos(2 * np.pi * (doy - 175) / 365.25)

    def ar1_series(scale: float) -> np.ndarray:
        e = rng.normal(0, scale, size=T)
        out = np.empty(T)
        out[0] = e[0]
        for t in range(1, T):
            out[t] = 0.8 * out[t - 1] + e[t]
        return out

    tmax = np.empty((T, H, W), dtype="float32")
    tmin = np.empty((T, H, W), dtype="float32")
    nmax = ar1_series(1.6)
    nmin = ar1_series(1.4)
    spatial_tmax = rng.normal(0, 0.4, size=(H, W))
    spatial_tmin = rng.normal(0, 0.4, size=(H, W))
    for t in range(T):
        tmax[t] = seas_tmax[t] - lapse + nmax[t] + spatial_tmax
        tmin[t] = seas_tmin[t] - lapse + nmin[t] + spatial_tmin
    tmin = np.minimum(tmin, tmax - 1.0)  # keep tmin < tmax

    # --- Rainfall: zero-inflated, monsoon-peaked, spatially smooth ----------
    # wet-day probability and intensity both peak in the monsoon (Jul-Sep).
    monsoon = np.exp(-0.5 * ((doy - 210) / 35) ** 2)  # bump centered ~end-July
    p_wet = 0.04 + 0.55 * monsoon                      # 4% dry season .. ~60% peak
    intensity = 3.0 + 22.0 * monsoon                   # mean mm on a wet day
    rainfall = np.zeros((T, H, W), dtype="float32")
    # mild spatial gradient (slightly wetter NE)
    rain_field_bias = 1.0 + 0.15 * (latg - lats.mean()) + 0.10 * (long - lons.mean())
    for t in range(T):
        wet = rng.random((H, W)) < p_wet[t]
        amt = rng.gamma(shape=1.4, scale=intensity[t] / 1.4, size=(H, W))
        rainfall[t] = np.where(wet, amt * rain_field_bias, 0.0).clip(min=0.0)

    elev_t = np.broadcast_to(elevation, (T, H, W))
    ds = xr.Dataset(
        {
            "rainfall": (("time", "lat", "lon"), rainfall),
            "tmax": (("time", "lat", "lon"), tmax),
            "tmin": (("time", "lat", "lon"), tmin),
            "elevation": (("time", "lat", "lon"), elev_t.astype("float32")),
        },
        coords={"time": time, "lat": lats, "lon": lons},
    )
    ds.attrs["data_source"] = "synthetic"
    ds.attrs["data_source_note"] = (
        "Plausible generated climatology for offline development/demo — NOT observed "
        "IMD data. Rebuild with --source imd for real national data."
    )
    return ds


# --------------------------------------------------------------------------- #
# Real IMD path via imdlib.
# --------------------------------------------------------------------------- #
def load_imd() -> xr.Dataset:
    """Download (cached) + assemble the real IMD cube. Raises if imdlib/network fails."""
    import imdlib as imd  # noqa: F401  (import here so synthetic path needs no imdlib)

    cfg.ensure_dirs()
    y0, y1 = cfg.PILOT["years"]
    raw = str(cfg.RAW_DIR)
    for v in ("rain", "tmax", "tmin"):
        imd.get_data(v, y0, y1, fn_format="yearwise", file_dir=raw, sub_dir=True)

    rain = _as_dataarray(imd.open_data("rain", y0, y1, "yearwise", raw).get_xarray())
    tmax = _as_dataarray(imd.open_data("tmax", y0, y1, "yearwise", raw).get_xarray())
    tmin = _as_dataarray(imd.open_data("tmin", y0, y1, "yearwise", raw).get_xarray())

    # Mask IMD no-data flags (rainfall -999; temperature 99.9 AND -999).
    rain = rain.where(rain != -999.0)
    tmax = tmax.where((tmax != 99.9) & (tmax != -999.0))
    tmin = tmin.where((tmin != 99.9) & (tmin != -999.0))

    lats, lons = cfg.grid_axes()
    # Clip rainfall (already 0.25 deg) then regrid both temps onto the rainfall grid.
    rain = _to_grid(rain, lats, lons)
    tmax = _to_grid(tmax, lats, lons)
    tmin = _to_grid(tmin, lats, lons)

    # Static elevation: real terrain from data/raw/dem/ (CartoDEM/SRTM) if present, else a
    # flat plain placeholder. Drop GeoTIFF tiles in data/raw/dem/ to enable the real DEM.
    H, W = lats.size, lons.size
    from data.ingest_dem import grid_elevation
    real = grid_elevation(lats, lons, cfg.PILOT["res_deg"])
    if real is not None:
        elev2d, elev_note = real, "elevation from a real DEM (CartoDEM/SRTM, data/raw/dem/)"
        print(f"[build_cube] real DEM elevation: {real.min():.0f}–{real.max():.0f} m")
    else:
        elev2d, elev_note = np.full((H, W), 215.0, dtype="float32"), "elevation is a placeholder plain (drop a DEM in data/raw/dem/ for real terrain)"
    elev = xr.DataArray(
        np.broadcast_to(elev2d, (rain.time.size, H, W)).astype("float32"),
        coords={"time": rain.time, "lat": lats, "lon": lons},
        dims=("time", "lat", "lon"),
    )

    ds = xr.Dataset({"rainfall": rain, "tmax": tmax, "tmin": tmin, "elevation": elev})
    ds = ds.sel(time=slice(f"{y0}-01-01", f"{y1}-12-31"))
    ds.attrs["data_source"] = "imd"
    ds.attrs["data_source_note"] = (
        f"IMD gridded rainfall (0.25 deg) + Tmax/Tmin (1 deg, regridded) via imdlib. {elev_note}."
    )
    return ds


def _as_dataarray(x):
    """imdlib .get_xarray() returns a Dataset; extract its single data variable."""
    if isinstance(x, xr.Dataset):
        name = list(x.data_vars)[0]
        return x[name].rename(name)
    return x


def _to_grid(da: xr.DataArray, lats, lons) -> xr.DataArray:
    """Clip+interpolate a DataArray onto the common pilot grid (bilinear)."""
    # imdlib uses 'lat'/'lon'; ensure ascending then interp onto target grid.
    da = da.sortby("lat").sortby("lon")
    return da.interp(lat=lats, lon=lons, method="linear")


# --------------------------------------------------------------------------- #
# Normalization stats (TRAIN YEARS ONLY).
# --------------------------------------------------------------------------- #
def compute_norm_stats(ds: xr.Dataset) -> dict:
    """Per-variable mean/std on TRAIN years only. Rainfall stats on log1p."""
    ty0, ty1 = cfg.SPLIT["train"]
    train = ds.sel(time=slice(f"{ty0}-01-01", f"{ty1}-12-31"))
    stats = {"_split": cfg.SPLIT, "_train_years": [ty0, ty1]}
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


# --------------------------------------------------------------------------- #
# Orchestration.
# --------------------------------------------------------------------------- #
def build(source: str = "auto", seed: int = 0, with_lst: bool = False) -> xr.Dataset:
    cfg.ensure_dirs()
    if source == "synthetic":
        ds = make_synthetic(seed)
    elif source == "imd":
        ds = load_imd()
    elif source == "auto":
        try:
            ds = load_imd()
        except Exception as e:  # network/imdlib/portal failure -> offline fallback
            print(f"[build_cube] IMD path failed ({type(e).__name__}: {e}).")
            print("[build_cube] Falling back to SYNTHETIC offline cube.")
            ds = make_synthetic(seed)
    else:
        raise ValueError(f"unknown source: {source!r}")

    # Optional INSAT LST fusion (indigenous satellite channel).
    if with_lst:
        from data.ingest_insat import build_lst
        time_index = pd.DatetimeIndex(ds["time"].values)
        lst = build_lst(source="auto", time_index=time_index)
        lst = lst.reindex(time=time_index, method="nearest").interp(
            lat=ds["lat"], lon=ds["lon"], method="linear")
        ds["lst"] = lst
        ds.attrs["lst_source"] = lst.attrs.get("lst_source", "unknown")
        print(f"[build_cube] fused INSAT LST channel (source={ds.attrs['lst_source']})")

    ds.attrs.update(
        region=cfg.PILOT["name"],
        bbox=[cfg.PILOT["lon_min"], cfg.PILOT["lat_min"], cfg.PILOT["lon_max"], cfg.PILOT["lat_max"]],
        res_deg=cfg.PILOT["res_deg"],
        years=list(cfg.PILOT["years"]),
        variables=cfg.VARS,
    )

    cfg.CUBE_PATH.parent.mkdir(parents=True, exist_ok=True)
    # netCDF can't store list/dict attrs cleanly -> json-encode the awkward ones.
    enc_attrs = dict(ds.attrs)
    enc_attrs["bbox"] = json.dumps(enc_attrs["bbox"])
    enc_attrs["years"] = json.dumps(enc_attrs["years"])
    enc_attrs["variables"] = json.dumps(enc_attrs["variables"])
    ds.attrs = enc_attrs
    ds.to_netcdf(cfg.CUBE_PATH)

    stats = compute_norm_stats(ds)
    cfg.NORM_STATS_PATH.write_text(json.dumps(stats, indent=2))

    print(f"[build_cube] wrote {cfg.CUBE_PATH}  source={ds.attrs['data_source']}")
    print(f"[build_cube]   dims time={ds.time.size} lat={ds.lat.size} lon={ds.lon.size}")
    print(f"[build_cube]   dates {str(ds.time.values[0])[:10]} .. {str(ds.time.values[-1])[:10]}")
    print(f"[build_cube] wrote {cfg.NORM_STATS_PATH} (train years only)")
    return ds


def main():
    p = argparse.ArgumentParser(description="Build twin_cube.nc")
    p.add_argument("--source", choices=["auto", "imd", "synthetic"], default="auto")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--with-lst", action="store_true", help="fuse INSAT LST channel")
    args = p.parse_args()
    build(source=args.source, seed=args.seed, with_lst=args.with_lst)


if __name__ == "__main__":
    main()
