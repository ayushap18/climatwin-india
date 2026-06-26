"""data/ingest_indmet.py — INDmet 0.05° (~5 km) daily fields over the pilot box.

INDmet (Zenodo 10.5281/zenodo.15430548, CC-BY-4.0, Water & Climate Lab IIT Gandhinagar)
is a high-resolution daily precipitation + tmax + tmin product for India, 1981–2024,
blended from IMD + CHIRPS + ERA5-Land. We use it as a GENUINE high-resolution ground
truth: the project's own IMD cube is 0.25°, so INDmet at 0.05° is a real 5× finer target
for the downscaler (no more "coarsen-then-upscale our own grid" caveat) and a finer cube
for the pilot region.

Honesty (CLAUDE.md §2.2/§2.7): INDmet is a *blended/derived* product, not pure IMD station
gridding — we label it as such (`data_source="indmet"`). It is an auxiliary high-res layer
that stays national-data-first (IMD is a primary input to INDmet).

Access: the NetCDF lives inside ONE 16 GB zip on Zenodo, but split per-variable × per-year
inside. Zenodo serves HTTP range requests, so we pull ONLY the members we need with
remotezip — e.g. 24 years of rainfall ≈ 0.86 GB instead of the full 40 GB record.

CLI:
    python -m data.ingest_indmet --vars rainfall --years 2000 2023
    python -m data.ingest_indmet --vars rainfall tmax tmin --years 2015 2023 --out data/indmet_cube_005.nc
"""
from __future__ import annotations

import argparse
import glob
import time
from pathlib import Path

import numpy as np
import xarray as xr

import config as cfg

ZIP_URL = "https://zenodo.org/api/records/15430548/files/INDmet_Netcdf_Data.zip/content"
RAW_DIR = cfg.DATA_DIR / "raw" / "indmet"
DEFAULT_OUT = cfg.DATA_DIR / "indmet_cube_005.nc"

# our var name -> (INDmet folder, INDmet variable name)
VAR_MAP = {
    "rainfall": ("Precipitation", "precipitation"),
    "tmax": ("Tmax", "tmax"),
    "tmin": ("Tmin", "tmin"),
}


def _member(var: str, year: int) -> str:
    folder, iv = VAR_MAP[var]
    return f"INDmet_Netcdf_Data/Yearly_File_{folder}/INDmet_{iv}_05km_{year}.nc"


def download(vars_: list[str], years: range) -> None:
    """Selectively extract only the needed per-variable/per-year members from the remote zip."""
    from remotezip import RemoteZip

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    wanted = [_member(v, y) for v in vars_ for y in years]
    todo = [m for m in wanted if not (RAW_DIR / m).exists()]
    if not todo:
        print(f"[indmet] all {len(wanted)} files already cached")
        return
    print(f"[indmet] fetching {len(todo)}/{len(wanted)} members from Zenodo (range requests)…")
    t0 = time.time()
    # large initial buffer so the End-Of-Central-Directory comes in one ranged GET
    with RemoteZip(ZIP_URL, initial_buffer_size=1_000_000) as z:
        have = set(z.namelist())
        for i, m in enumerate(todo, 1):
            if m not in have:
                raise FileNotFoundError(f"INDmet member not on record: {m}")
            z.extract(m, path=str(RAW_DIR))
            print(f"[indmet]   [{i}/{len(todo)}] {Path(m).name}  ({time.time()-t0:.0f}s)", flush=True)
    print(f"[indmet] download done in {time.time()-t0:.0f}s")


def _load_var(var: str, years: range) -> xr.DataArray:
    folder, iv = VAR_MAP[var]
    files = sorted(
        f for f in glob.glob(str(RAW_DIR / "**" / f"INDmet_{iv}_05km_*.nc"), recursive=True)
        if int(Path(f).stem.split("_")[-1]) in years
    )
    if not files:
        raise FileNotFoundError(f"no cached INDmet {var} files for {years.start}-{years.stop-1}; run download() first")
    # Open + clip each year to the bbox, load into memory, then concat (no dask needed;
    # clipping to ~40×60 first keeps it tiny).
    parts = []
    for f in files:
        with xr.open_dataset(f) as d:
            da = d[iv].sortby("lat").sortby("lon").sel(
                lat=slice(cfg.PILOT["lat_min"], cfg.PILOT["lat_max"]),
                lon=slice(cfg.PILOT["lon_min"], cfg.PILOT["lon_max"]),
            ).load()
        parts.append(da)
    da = xr.concat(parts, dim="time").sortby("time")
    return da.rename(var)


def build(vars_: list[str], years: range, out: Path) -> xr.Dataset:
    """Assemble a 0.05° cube over the pilot box. rainfall in mm, temps in degC, daily."""
    data = {v: _load_var(v, years) for v in vars_}
    ds = xr.Dataset(data).load()
    # INDmet precipitation is mm/day (→ mm), tmax/tmin already degC — no unit conversion.
    ds.attrs["data_source"] = "indmet"
    ds.attrs["resolution_deg"] = 0.05
    ds.attrs["data_source_note"] = (
        "INDmet 0.05° (~5 km) daily fields (Zenodo 10.5281/zenodo.15430548, CC-BY-4.0), "
        "blended IMD + CHIRPS + ERA5-Land. Genuine high-res truth for downscaling; "
        "labeled blended (not pure IMD station gridding)."
    )
    ny, nx = ds.sizes["lat"], ds.sizes["lon"]
    print(f"[indmet] built cube: vars={list(ds.data_vars)} grid={ny}×{nx} "
          f"days={ds.sizes['time']} range={str(ds.time.values[0])[:10]}..{str(ds.time.values[-1])[:10]}")
    out.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(out)
    print(f"[indmet] wrote {out} ({out.stat().st_size/1e6:.1f} MB)")
    return ds


def main() -> None:
    p = argparse.ArgumentParser(description="Ingest INDmet 0.05° over the pilot box")
    p.add_argument("--vars", nargs="+", default=["rainfall"], choices=list(VAR_MAP))
    p.add_argument("--years", nargs=2, type=int, default=[cfg.PILOT["years"][0], cfg.PILOT["years"][1]],
                   metavar=("START", "END"))
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--download-only", action="store_true")
    args = p.parse_args()
    years = range(args.years[0], args.years[1] + 1)
    download(args.vars, years)
    if not args.download_only:
        build(args.vars, years, args.out)


if __name__ == "__main__":
    main()
