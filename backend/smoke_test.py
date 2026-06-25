"""backend/smoke_test.py — end-to-end check of the ClimaTwin slice.

Boots the app in-process (TestClient) and exercises every endpoint, asserting the
twin loop, forecast, what-if diff, impacts and validation all behave. No network,
no running server needed.  Run:  python -m backend.smoke_test
"""
from __future__ import annotations

import sys

from fastapi.testclient import TestClient

import config as cfg
from backend.app import app


def main() -> int:
    with TestClient(app) as c:
        # --- health / meta -------------------------------------------------
        h = c.get("/health").json()
        assert h["status"] == "ok", h
        meta = c.get("/meta").json()
        H, W = meta["grid"]["shape"]
        assert [H, W] == [len(cfg.grid_axes()[0]), len(cfg.grid_axes()[1])]
        latest = meta["latest_date"]
        print(f"[smoke] health/meta OK  source={meta['data_source']} grid={H}x{W} latest={latest}")

        # --- state (mirror) -----------------------------------------------
        st = c.get("/state", params={"date": "2023-07-15"}).json()
        assert set(st["fields"]) == set(cfg.VARS), st["fields"].keys()
        assert len(st["fields"]["tmax"]) == H and len(st["fields"]["tmax"][0]) == W
        assert "dryness_index" in st["impacts"]
        print(f"[smoke] /state OK  mean_rain={st['impacts']['mean_rainfall_mm']} "
              f"heat_frac={st['impacts']['heat_stress_fraction']}")

        # --- forecast (simulate) ------------------------------------------
        for model in meta["models"]:
            fc = c.get("/forecast", params={"date": "2023-07-15", "horizon": 7, "model": model}).json()
            assert len(fc["days"]) == 7, fc
            assert fc["days"][0]["lead_day"] == 1
            print(f"[smoke] /forecast model={model} OK  "
                  f"d1 mean_tmax={_mean(fc['days'][0]['fields']['tmax'])} "
                  f"sowing_ok={fc['sowing_window']['sowing_ok']}")

        # --- what-if (perturb) --------------------------------------------
        wi = c.post("/whatif", json={
            "date": "2023-07-15", "horizon": 7,
            "delta_temp": 3.0, "rain_factor": 0.5,
            "urban_polygon": [[28.4, 76.8], [28.4, 77.6], [29.0, 77.6], [29.0, 76.8]],
            "urban_lst": 2.5, "model": "climatology",
        }).json()
        d0 = wi["days"][0]
        dtmax = _mean(d0["diff"]["tmax"])
        drain = _mean(d0["diff"]["rainfall"])
        assert dtmax >= 3.0 - 1e-6, f"expected dTmax >= 3, got {dtmax}"
        assert drain <= 0.0, f"expected rain to drop, got {drain}"
        assert wi["scenario_params"]["urban_cells"] > 0
        print(f"[smoke] /whatif OK  dTmax~{dtmax} dRain~{drain} "
              f"urban_cells={wi['scenario_params']['urban_cells']}")

        # --- validate ------------------------------------------------------
        if not cfg.METRICS_PATH.exists():
            print("[smoke] /validate skipped (run `make validate` first)")
        else:
            val = c.get("/validate").json()
            assert "horizons" in val and "summary_rmse" in val
            s1 = val["summary_rmse"]["1"]["rainfall"]
            print(f"[smoke] /validate OK  rainfall@1d persistence={s1['persistence_RMSE']} "
                  f"climatology={s1['climatology_RMSE']} best={s1['best']}")

    print("\n[smoke] ALL ENDPOINTS PASSED ✅")
    return 0


def _mean(grid):
    flat = [v for row in grid for v in row]
    return round(sum(flat) / len(flat), 2)


if __name__ == "__main__":
    sys.exit(main())
