"""data/ingest_insat.py — INSAT-3D Land Surface Temperature (LST) from MOSDAC.

The indigenous / Atmanirbhar satellite layer (CLAUDE.md §2.2, files/data_access.md §2).
Produces ``data/insat_lst.nc`` (daily LST on the pilot 0.25 deg grid) which
``build_cube.py`` fuses into the cube as the ``lst`` channel.

THREE source paths (auto-detected, honest provenance tagged in the output attrs):
  1. ``data/raw/insat/*.h5``  — real INSAT-3D L2B/L2G LST granules already downloaded
     (e.g. via MOSDAC's official `mdapi` client). We read with h5py, regrid the
     ~4 km geostationary grid onto 0.25 deg (scipy griddata), and aggregate to daily.
  2. MOSDAC mdapi download    — if creds + the official client are configured, fetch
     granules first, then path (1). (Registration required; approval latency — see docs.)
  3. ``synthetic_demo``       — offline plausible LST with an urban hot-spot over the
     Delhi core, INDEPENDENT of IMD temperature, so the fusion architecture + the
     urban-heat what-if are demonstrable with no network. Tagged clearly.

Run:  python -m data.ingest_insat                 # auto: real h5 if present, else demo
      python -m data.ingest_insat --source demo   # force offline demo LST
"""
from __future__ import annotations

import argparse
import glob

import numpy as np
import pandas as pd
import xarray as xr

import config as cfg

RAW_INSAT_DIR = cfg.RAW_DIR / "insat"
LST_PATH = cfg.DATA_DIR / "insat_lst.nc"
MOSDAC_CONFIG = cfg.DATA_DIR / "mosdac_config.json"   # gitignored; copy from scripts/mosdac_config.example.json
MDAPI_DIR = cfg.DATA_DIR / "mdapi"                    # official MOSDAC client lands here
MDAPI_URL = "https://mosdac.gov.in/software/mdapi.zip"

# Common SDS / geolocation key candidates across INSAT-3D product versions.
_LST_KEYS = ["LST", "Land_Surface_Temperature", "lst"]
_LAT_KEYS = ["Latitude", "latitude", "lat"]
_LON_KEYS = ["Longitude", "longitude", "lon"]


# --------------------------------------------------------------------------- #
# Real granule ingestion (h5py + regrid).
# --------------------------------------------------------------------------- #
def _first_key(f, candidates):
    for k in candidates:
        if k in f:
            return k
    # search one level down (some products nest under a group)
    for grp in f.keys():
        try:
            for k in candidates:
                if k in f[grp]:
                    return f"{grp}/{k}"
        except Exception:
            pass
    return None


def _granule_datetime(path: str):
    """Parse the acquisition date from a name like 3DIMG_15JUL2023_0600_L2B_LST.h5."""
    import re
    m = re.search(r"(\d{2}[A-Z]{3}\d{4})", path.upper())
    if m:
        return pd.to_datetime(m.group(1), format="%d%b%Y")
    return None


def ingest_h5_dir(h5_dir=RAW_INSAT_DIR) -> xr.DataArray | None:
    """Read INSAT LST granules, regrid to the pilot grid, aggregate to daily mean."""
    import h5py
    from scipy.interpolate import griddata

    files = sorted(glob.glob(str(h5_dir / "*.h5")) + glob.glob(str(h5_dir / "*.hdf")))
    if not files:
        return None

    lats, lons = cfg.grid_axes()
    tgt_lat, tgt_lon = np.meshgrid(lats, lons, indexing="ij")
    by_day: dict = {}

    for path in files:
        try:
            with h5py.File(path, "r") as f:
                lk = _first_key(f, _LST_KEYS)
                lat_k = _first_key(f, _LAT_KEYS)
                lon_k = _first_key(f, _LON_KEYS)
                if not (lk and lat_k and lon_k):
                    print(f"[insat] skip {path}: missing LST/geo keys")
                    continue
                lst = np.array(f[lk][:], dtype="float32").squeeze()
                glat = np.array(f[lat_k][:], dtype="float32").squeeze()
                glon = np.array(f[lon_k][:], dtype="float32").squeeze()
        except Exception as e:
            print(f"[insat] skip {path}: {type(e).__name__}: {e}")
            continue

        lst = np.where(lst < -100, np.nan, lst)  # fill flags
        # Kelvin -> Celsius if needed (INSAT LST is typically Kelvin).
        if np.nanmedian(lst) > 150:
            lst = lst - 273.15
        # broadcast 1-D geolocation (L2G regular grid) to 2-D
        if glat.ndim == 1 and glon.ndim == 1:
            glon2, glat2 = np.meshgrid(glon, glat)
        else:
            glat2, glon2 = glat, glon
        m = np.isfinite(lst) & np.isfinite(glat2) & np.isfinite(glon2)
        if m.sum() < 4:
            continue
        grid = griddata((glat2[m], glon2[m]), lst[m], (tgt_lat, tgt_lon), method="linear")
        day = _granule_datetime(path)
        if day is None:
            continue
        by_day.setdefault(day, []).append(grid)

    if not by_day:
        return None
    days = sorted(by_day)
    stack = np.stack([np.nanmean(by_day[d], axis=0) for d in days]).astype("float32")
    da = xr.DataArray(stack, coords={"time": pd.DatetimeIndex(days), "lat": lats, "lon": lons},
                      dims=("time", "lat", "lon"), name="lst")
    da.attrs["lst_source"] = "insat_real"
    print(f"[insat] ingested {len(files)} granules -> {len(days)} daily LST fields")
    return da


# --------------------------------------------------------------------------- #
# Offline demo LST (independent of IMD temperature).
# --------------------------------------------------------------------------- #
def synthetic_demo_lst(time_index: pd.DatetimeIndex, seed: int = 7) -> xr.DataArray:
    """Plausible daily LST with a persistent urban hot-spot over the Delhi core.

    Deliberately built from its OWN seasonal signal + an urban polygon bump + noise
    (NOT copied from tmax) so it carries an independent spatial heat signature that
    the model and the urban what-if can exploit. Tagged synthetic_demo.
    """
    rng = np.random.default_rng(seed)
    lats, lons = cfg.grid_axes()
    H, W = lats.size, lons.size
    latg, long = np.meshgrid(lats, lons, indexing="ij")
    doy = time_index.dayofyear.to_numpy()

    # LST seasonal cycle (skin temp swings wider than air temp): warm pre-monsoon.
    seas = 33.0 + 12.0 * np.cos(2 * np.pi * (doy - 160) / 365.25)
    # urban hot-spot: Gaussian bump centered on Delhi (~28.6N, 77.2E)
    urban = 4.5 * np.exp(-(((latg - 28.6) / 0.4) ** 2 + ((long - 77.2) / 0.5) ** 2))
    T = len(time_index)
    arr = np.empty((T, H, W), dtype="float32")
    base_noise = rng.normal(0, 0.6, size=(H, W))
    for t in range(T):
        arr[t] = seas[t] + urban + base_noise + rng.normal(0, 1.0, size=(H, W))
    da = xr.DataArray(arr, coords={"time": time_index, "lat": lats, "lon": lons},
                      dims=("time", "lat", "lon"), name="lst")
    da.attrs["lst_source"] = "synthetic_demo"
    return da


# --------------------------------------------------------------------------- #
# Real download via the official MOSDAC mdapi client (best-effort driver).
# --------------------------------------------------------------------------- #
def download_via_mdapi(config_path=MOSDAC_CONFIG) -> int:
    """Fetch INSAT granules into RAW_INSAT_DIR using the official MOSDAC mdapi client.

    Drives MOSDAC's own client (mdapi.py) rather than reimplementing their API, so
    auth/throttling/format quirks are handled upstream. Requires data/mosdac_config.json
    (copy scripts/mosdac_config.example.json, add your approved credentials).
    Returns the number of .h5 granules present in RAW_INSAT_DIR afterward.
    Raises RuntimeError with clear guidance if it cannot proceed.
    """
    import json
    import shutil
    import subprocess
    import sys
    import zipfile

    if not config_path.exists():
        raise RuntimeError(
            f"MOSDAC config not found at {config_path}. Copy scripts/mosdac_config.example.json "
            f"to {config_path} and fill in your approved MOSDAC username/password.")

    cfg.ensure_dirs()
    RAW_INSAT_DIR.mkdir(parents=True, exist_ok=True)
    MDAPI_DIR.mkdir(parents=True, exist_ok=True)
    client = MDAPI_DIR / "mdapi.py"

    # 1) ensure the official client is present (the client zip is a public download).
    if not client.exists():
        try:
            import requests
            print(f"[insat] fetching MOSDAC client {MDAPI_URL}")
            r = requests.get(MDAPI_URL, timeout=60)
            r.raise_for_status()
            zpath = MDAPI_DIR / "mdapi.zip"
            zpath.write_bytes(r.content)
            with zipfile.ZipFile(zpath) as z:
                z.extractall(MDAPI_DIR)
        except Exception as e:
            raise RuntimeError(
                f"could not obtain the MOSDAC client ({type(e).__name__}: {e}). "
                f"Manually download {MDAPI_URL}, unzip into {MDAPI_DIR}/, and re-run. "
                f"Alternatively, just drop INSAT-3D .h5 granules into {RAW_INSAT_DIR}/.")
        # the zip may nest mdapi.py one level down -> find it
        if not client.exists():
            found = list(MDAPI_DIR.rglob("mdapi.py"))
            if found:
                client = found[0]

    if not client.exists():
        raise RuntimeError(
            f"mdapi.py not found under {MDAPI_DIR}. Unzip the MOSDAC client there, or drop "
            f".h5 granules into {RAW_INSAT_DIR}/ directly.")

    # 2) hand our config to the client (it reads config.json next to itself) and run it.
    user_cfg = json.loads(config_path.read_text())
    user_cfg.pop("_comment", None)
    user_cfg.setdefault("download_settings", {})["download_path"] = str(RAW_INSAT_DIR)
    (client.parent / "config.json").write_text(json.dumps(user_cfg, indent=2))
    print(f"[insat] running MOSDAC client: {client}")
    proc = subprocess.run([sys.executable, client.name], cwd=str(client.parent),
                          capture_output=True, text=True)
    print(proc.stdout[-2000:] if proc.stdout else "")
    if proc.returncode != 0:
        print(proc.stderr[-2000:])
        raise RuntimeError(
            f"MOSDAC client exited {proc.returncode}. Check credentials/approval and "
            f"{client.parent}/error log; or drop .h5 granules into {RAW_INSAT_DIR}/ manually.")

    n = len(glob.glob(str(RAW_INSAT_DIR / "*.h5")))
    print(f"[insat] mdapi download complete: {n} granules in {RAW_INSAT_DIR}")
    return n


# --------------------------------------------------------------------------- #
# Orchestration.
# --------------------------------------------------------------------------- #
def build_lst(source: str = "auto", time_index: pd.DatetimeIndex | None = None) -> xr.DataArray:
    """Return a daily LST DataArray on the pilot grid; cache to data/insat_lst.nc."""
    cfg.ensure_dirs()
    RAW_INSAT_DIR.mkdir(parents=True, exist_ok=True)
    da = None
    if source in ("auto", "real"):
        da = ingest_h5_dir()
        if da is None and source == "real":
            # no granules yet -> try the official MOSDAC client if creds are configured
            if MOSDAC_CONFIG.exists():
                download_via_mdapi()        # raises with guidance if it can't proceed
                da = ingest_h5_dir()
            if da is None:
                raise RuntimeError(
                    f"no INSAT granules in {RAW_INSAT_DIR} and no usable MOSDAC config at "
                    f"{MOSDAC_CONFIG}. Either copy scripts/mosdac_config.example.json -> "
                    f"{MOSDAC_CONFIG} with your credentials, or drop INSAT-3D .h5 granules "
                    f"into {RAW_INSAT_DIR}/ and re-run.")
    if da is None:
        if time_index is None:
            y0, y1 = cfg.PILOT["years"]
            time_index = pd.date_range(f"{y0}-01-01", f"{y1}-12-31", freq="D")
        da = synthetic_demo_lst(time_index)
        print(f"[insat] using OFFLINE synthetic_demo LST ({len(time_index)} days). "
              f"Provide real granules in {RAW_INSAT_DIR} or MOSDAC creds for the real layer.")
    da.to_netcdf(LST_PATH)
    print(f"[insat] wrote {LST_PATH}  source={da.attrs.get('lst_source')}")
    return da


def main():
    p = argparse.ArgumentParser(description="Build INSAT LST layer")
    p.add_argument("--source", choices=["auto", "real", "demo"], default="auto")
    args = p.parse_args()
    build_lst(source="real" if args.source == "real" else ("auto" if args.source == "auto" else "demo"))


if __name__ == "__main__":
    main()
