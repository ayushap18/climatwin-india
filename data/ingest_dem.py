"""data/ingest_dem.py — real terrain elevation for the pilot grid (CartoDEM / SRTM / Copernicus).

Replaces the flat 215 m placeholder with genuine orography so the ConvLSTM + SR-CNN downscaler
get a real elevation channel (and the Atmanirbhar story can cite Bhuvan CartoDEM).

Source-agnostic: drop ANY GeoTIFF DEM tile(s) covering the pilot bbox into data/raw/dem/ and
this merges + clips + block-averages them onto the 0.25° grid. Works for:
  * Bhuvan CartoDEM v3 R1 (30 m, India) — the indigenous/preferred source (needs a Bhuvan login)
  * SRTM 1-arc-sec / Copernicus GLO-30 / OpenTopography — easy no-login fallbacks
Assumes the tiles are in geographic lat/lon (EPSG:4326); reprojects if not.

API:
    grid_elevation(lats, lons, res) -> (H,W) float32 mean elevation per cell, or None if no DEM.
The result is cached at data/elevation_grid.npy. Delete it to re-ingest new tiles.
"""
from __future__ import annotations

from typing import Optional

import numpy as np

import config as cfg

DEM_DIR = cfg.RAW_DIR / "dem"               # drop DEM GeoTIFF tiles here
CACHE = cfg.DATA_DIR / "elevation_grid.npy"


def grid_elevation(lats: np.ndarray, lons: np.ndarray, res: float) -> Optional[np.ndarray]:
    """Mean DEM elevation per (lat,lon) grid cell. None if no tiles are present."""
    lats = np.asarray(lats); lons = np.asarray(lons)
    if CACHE.exists():
        cached = np.load(CACHE)
        if cached.shape == (lats.size, lons.size):
            return cached.astype("float32")

    tifs = sorted(DEM_DIR.glob("*.tif")) + sorted(DEM_DIR.glob("*.tiff"))
    if not tifs:
        return None

    import rasterio
    from rasterio.merge import merge
    from rasterio.warp import calculate_default_transform, reproject, Resampling
    import rasterio.transform as rtransform

    srcs = [rasterio.open(t) for t in tifs]
    # reproject any non-4326 tile to lat/lon so cell windows are simple
    geo = []
    for s in srcs:
        if s.crs and s.crs.to_epsg() != 4326:
            dst_t, w, h = calculate_default_transform(s.crs, "EPSG:4326", s.width, s.height, *s.bounds)
            data = np.empty((h, w), dtype="float32")
            reproject(rasterio.band(s, 1), data, src_transform=s.transform, src_crs=s.crs,
                      dst_transform=dst_t, dst_crs="EPSG:4326", resampling=Resampling.bilinear)
            mem = rasterio.io.MemoryFile()
            ds = mem.open(driver="GTiff", height=h, width=w, count=1, dtype="float32",
                          crs="EPSG:4326", transform=dst_t, nodata=s.nodata)
            ds.write(data, 1)
            geo.append(ds)
        else:
            geo.append(s)

    mosaic, transform = merge(geo)            # (1, H, W)
    dem = mosaic[0].astype("float32")
    nod = geo[0].nodata
    if nod is not None:
        dem[dem == nod] = np.nan
    dem[dem < -1000] = np.nan                 # guard against fill values

    H, W = lats.size, lons.size
    out = np.full((H, W), np.nan, dtype="float32")
    h = res / 2.0
    Hd, Wd = dem.shape
    for i, la in enumerate(lats):
        for j, lo in enumerate(lons):
            # pixel rows/cols spanning the cell's lat/lon box
            r_top, c_left = rtransform.rowcol(transform, lo - h, la + h)
            r_bot, c_right = rtransform.rowcol(transform, lo + h, la - h)
            r0, r1 = sorted((int(r_top), int(r_bot)))
            c0, c1 = sorted((int(c_left), int(c_right)))
            r0, c0 = max(0, r0), max(0, c0)
            r1, c1 = min(Hd, r1 + 1), min(Wd, c1 + 1)
            if r1 > r0 and c1 > c0:
                block = dem[r0:r1, c0:c1]
                if np.isfinite(block).any():
                    out[i, j] = float(np.nanmean(block))

    if not np.isfinite(out).any():
        return None
    out = np.where(np.isfinite(out), out, np.nanmean(out)).astype("float32")
    np.save(CACHE, out)
    print(f"[dem] elevation grid {H}×{W} from {len(tifs)} tile(s): "
          f"{out.min():.0f}–{out.max():.0f} m (mean {out.mean():.0f}) → cached {CACHE.name}")
    return out


if __name__ == "__main__":
    la, lo = cfg.grid_axes()
    e = grid_elevation(la, lo, cfg.PILOT["res_deg"])
    print("no DEM tiles in data/raw/dem/ — drop GeoTIFFs there first." if e is None
          else f"OK: elevation {e.shape}, {e.min():.0f}–{e.max():.0f} m")
