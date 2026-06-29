"""data/mosdac_client.py — native MOSDAC download-API client.

A small ``requests``-based client that speaks the SAME HTTP contract as ISRO's
official ``mdapi.py`` tool, but without its interactive ``[Y/N]`` prompt, its
``sys.exit`` error handling, or the subprocess/zip dance. We drive the endpoints
directly so ``ingest_insat`` can fetch real INSAT-3D LST granules with clean,
typed errors and a lockout-safe auth path.

Contract (verified against the shipped mdapi.py):
  POST  /download_api/gettoken        {username, password}      -> {access_token, refresh_token}
  GET   /apios/datasets.json          {datasetId, startTime, endTime, count, boundingBox, gId, startIndex}
                                       -> {totalResults, totalSizeMB, itemsPerPage, entries:[{id, identifier, updated}]}
  GET   /download_api/download         header Bearer, params {id}, stream -> .h5 (name = identifier)
  POST  /download_api/refresh-token   {refresh_token}           -> {access_token, refresh_token}
  POST  /download_api/logout          {username}

Config: reads ``data/mosdac_config.json`` (gitignored). The credential key is
literally ``"username/email"`` (matching the real client) — NOT ``"username"``.

CLI:
  python -m data.mosdac_client --search           # token + search only (1 login)
  python -m data.mosdac_client --download --limit 3
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import requests

import config as cfg

# Granule names look like 3DIMG_15JUL2020_0600_L2B_LST_V01R00.h5 — date + UTC HHMM.
_GRAN_DATE = re.compile(r"_(\d{2}[A-Z]{3}\d{4})_")
_GRAN_HHMM = re.compile(r"_(\d{2}[A-Z]{3}\d{4})_(\d{4})_")


def _hhmm_minutes(identifier: str) -> int | None:
    m = _GRAN_HHMM.search(identifier or "")
    if not m:
        return None
    hhmm = m.group(2)
    return int(hhmm[:2]) * 60 + int(hhmm[2:])

# --------------------------------------------------------------------------- #
# Endpoints (mirrors data/mdapi/mdapi.py exactly).
# --------------------------------------------------------------------------- #
BASE = "https://mosdac.gov.in"
TOKEN_URL = f"{BASE}/download_api/gettoken"
SEARCH_URL = f"{BASE}/apios/datasets.json"
DOWNLOAD_URL = f"{BASE}/download_api/download"
REFRESH_URL = f"{BASE}/download_api/refresh-token"
LOGOUT_URL = f"{BASE}/download_api/logout"

CONFIG_PATH = cfg.DATA_DIR / "mosdac_config.json"
DEFAULT_TIMEOUT = 60


# --------------------------------------------------------------------------- #
# Typed errors — so callers can distinguish "bad creds / not approved" from
# "network down" from "product not released" without scraping stdout.
# --------------------------------------------------------------------------- #
class MosdacError(RuntimeError):
    """Base error for the MOSDAC client."""


class MosdacConfigError(MosdacError):
    """Missing/invalid mosdac_config.json."""


class MosdacAuthError(MosdacError):
    """Credentials rejected, account not approved, or token invalid.

    Raised on the FIRST 400/401 from gettoken — we never retry auth, to stay
    clear of MOSDAC's 3-consecutive-failure / 1-hour lockout.
    """


class MosdacNotReleased(MosdacError):
    """The requested product/granule is not released for download."""


class MosdacRateLimit(MosdacError):
    """Daily download quota (5000/user/day) reached."""


# --------------------------------------------------------------------------- #
# Client.
# --------------------------------------------------------------------------- #
class MosdacClient:
    def __init__(self, config_path: Path | str = CONFIG_PATH, timeout: int = DEFAULT_TIMEOUT):
        self.config_path = Path(config_path)
        self.timeout = timeout
        self.cfg = self._load_config()
        self.session = requests.Session()
        self.access_token: str | None = None
        self.refresh_token: str | None = None

    # -- config -------------------------------------------------------------- #
    def _load_config(self) -> dict:
        if not self.config_path.exists():
            raise MosdacConfigError(
                f"MOSDAC config not found at {self.config_path}. Copy "
                f"scripts/mosdac_config.example.json there and fill in your "
                f"approved MOSDAC credentials.")
        try:
            data = json.loads(self.config_path.read_text())
        except json.JSONDecodeError as e:
            raise MosdacConfigError(f"Invalid JSON in {self.config_path}: {e}") from e
        data.pop("_comment", None)
        if "user_credentials" not in data or "search_parameters" not in data:
            raise MosdacConfigError(
                "mosdac_config.json must contain 'user_credentials' and "
                "'search_parameters' sections.")
        return data

    @property
    def username(self) -> str:
        # The real client reads the literal key "username/email".
        creds = self.cfg.get("user_credentials", {})
        return creds.get("username/email") or creds.get("username") or ""

    @property
    def password(self) -> str:
        return self.cfg.get("user_credentials", {}).get("password", "")

    def _search_params(self, start_index: int | None = None) -> dict:
        sp = self.cfg.get("search_parameters", {})
        params = {"datasetId": sp.get("datasetId", "")}
        optional = {
            "startTime": sp.get("startTime", ""),
            "endTime": sp.get("endTime", ""),
            "count": sp.get("count", ""),
            "boundingBox": sp.get("boundingBox", ""),
            "gId": sp.get("gId", ""),
        }
        # Drop empty values, exactly like mdapi.py.
        params.update({k: v for k, v in optional.items() if v not in ("", None)})
        if start_index is not None:
            params["startIndex"] = start_index
        return params

    def download_dir(self) -> Path:
        dl = self.cfg.get("download_settings", {}).get("download_path") or str(cfg.RAW_DIR / "insat")
        return Path(dl)

    # -- auth ---------------------------------------------------------------- #
    def get_token(self) -> None:
        """POST credentials, store tokens. Raises MosdacAuthError on rejection.

        Does NOT retry on auth failure (lockout safety).
        """
        if not self.username or not self.password:
            raise MosdacAuthError(
                "Missing 'username/email' or 'password' in mosdac_config.json.")
        try:
            r = self.session.post(
                TOKEN_URL, json={"username": self.username, "password": self.password},
                timeout=self.timeout)
        except requests.RequestException as e:
            raise MosdacError(f"Network error contacting MOSDAC token endpoint: {e}") from e

        if r.status_code in (400, 401):
            msg = self._error_message(r) or "Invalid credentials or account not approved."
            raise MosdacAuthError(f"MOSDAC auth failed ({r.status_code}): {msg}")
        if r.status_code == 429:
            # Rate-limited / temporary lockout (e.g. 3 consecutive failed logins -> ~1h).
            # Do NOT retry — surface a clear wait message so we don't deepen the lockout.
            raise MosdacRateLimit(
                "MOSDAC login rate-limited (429): too many attempts. Wait ~1 hour before "
                "trying again. (Credentials were not rejected — 429 is throttling, not 401.)")
        if r.status_code == 503:
            raise MosdacError("MOSDAC service unavailable (503). Try again later.")
        r.raise_for_status()
        body = r.json()
        self.access_token = body.get("access_token")
        self.refresh_token = body.get("refresh_token")
        if not self.access_token:
            raise MosdacAuthError("Token endpoint returned no access_token.")

    def refresh(self) -> None:
        if not self.refresh_token:
            raise MosdacAuthError("No refresh_token available; call get_token() first.")
        r = self.session.post(REFRESH_URL, json={"refresh_token": self.refresh_token},
                               timeout=self.timeout)
        if r.status_code == 400:
            raise MosdacAuthError(f"Refresh failed: {self._error_message(r)}")
        r.raise_for_status()
        body = r.json()
        self.access_token = body.get("access_token", self.access_token)
        self.refresh_token = body.get("refresh_token", self.refresh_token)

    def logout(self) -> None:
        if not self.username:
            return
        try:
            self.session.post(LOGOUT_URL, json={"username": self.username}, timeout=self.timeout)
        except requests.RequestException:
            pass  # best-effort

    # -- search -------------------------------------------------------------- #
    def search(self) -> dict:
        """Return the raw first-page search response (no auth required)."""
        try:
            r = self.session.get(SEARCH_URL, params=self._search_params(), timeout=self.timeout)
        except requests.RequestException as e:
            raise MosdacError(f"Network error contacting MOSDAC search endpoint: {e}") from e
        if r.status_code // 100 in (4, 5):
            raise MosdacError(
                f"Search failed ({r.status_code}): {self._error_message(r)}. "
                f"Check 'search_parameters' (datasetId/dates/boundingBox).")
        r.raise_for_status()
        return r.json()

    def list_granules(self, max_records: int | None = None) -> list[dict]:
        """Page through the search endpoint, returning [{id, identifier, updated}, ...]."""
        entries: list[dict] = []
        first = self.search()
        total = int(first.get("totalResults") or 0)
        target = total if max_records is None else min(total, max_records)
        start_index = 1
        while len(entries) < max(target, 0):
            params = self._search_params(start_index=start_index)
            r = self.session.get(SEARCH_URL, params=params, timeout=self.timeout)
            r.raise_for_status()
            body = r.json()
            page = body.get("entries") or []
            if not page:
                break
            for item in page:
                entries.append({
                    "id": item.get("id"),
                    "identifier": item.get("identifier"),
                    "updated": item.get("updated"),
                })
                if max_records is not None and len(entries) >= max_records:
                    return entries
            start_index += len(page)
        return entries

    # -- download ------------------------------------------------------------ #
    def download_granule(self, entry: dict, dest_dir: Path | str | None = None) -> Path | None:
        """Stream one granule to dest_dir/<identifier>. Requires a valid token."""
        if not self.access_token:
            raise MosdacAuthError("No access token; call get_token() first.")
        dest = Path(dest_dir) if dest_dir is not None else self.download_dir()
        dest.mkdir(parents=True, exist_ok=True)
        identifier = entry["identifier"]
        out_path = dest / identifier
        if out_path.exists():
            return out_path  # already downloaded

        headers = {"Authorization": f"Bearer {self.access_token}"}
        # Bounded retry loop so a per-minute throttle (429 minute_limit) or one expired
        # token doesn't abort a long 365-day pull.
        for attempt in range(6):
            r = self.session.get(DOWNLOAD_URL, headers=headers, params={"id": entry["id"]},
                                 stream=True, timeout=self.timeout)
            if r.status_code == 401:
                code = (r.json().get("code") if _is_json(r) else "") or ""
                if code in ("INVALID_TOKEN", "NO_ACCESS_TOKEN"):
                    self.refresh()
                    headers = {"Authorization": f"Bearer {self.access_token}"}
                    continue
            if r.status_code == 404 and _is_json(r) and r.json().get("code") == "NOT_RELEASED":
                raise MosdacNotReleased(f"{identifier}: not released for download.")
            if r.status_code == 429:
                body = r.json() if _is_json(r) else {}
                if body.get("type") == "daily_limit":
                    raise MosdacRateLimit(body.get("message", "Daily download quota (5000/day) reached."))
                # minute_limit -> wait and retry
                time.sleep(20)
                continue
            if r.status_code == 400:
                raise MosdacError(f"{identifier}: download validation error: {self._error_message(r)}")
            r.raise_for_status()
            break
        else:
            raise MosdacError(f"{identifier}: gave up after repeated rate-limit/token retries.")

        tmp = out_path.with_suffix(out_path.suffix + ".part")
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    fh.write(chunk)
        tmp.rename(out_path)
        return out_path

    def download_all(self, dest_dir: Path | str | None = None,
                     limit: int | None = None) -> list[Path]:
        """get_token (once) -> list granules -> download each. Returns saved paths."""
        if not self.access_token:
            self.get_token()
        granules = self.list_granules(max_records=limit)
        saved: list[Path] = []
        for g in granules:
            try:
                p = self.download_granule(g, dest_dir)
                if p is not None:
                    saved.append(p)
            except MosdacNotReleased:
                continue
        return saved

    # -- one-overpass-per-day download (for a focused daily LST cube) -------- #
    def _day_entries(self, day: str) -> list[dict]:
        """All granules for a single calendar day (startTime==endTime==day)."""
        params = self._search_params()
        params["startTime"] = day
        params["endTime"] = day
        r = self.session.get(SEARCH_URL, params=params, timeout=self.timeout)
        if r.status_code // 100 in (4, 5):
            return []
        body = r.json()
        return body.get("entries") or []

    def download_daily_overpass(self, start: str, end: str, target_hhmm: str = "0600",
                                dest_dir: Path | str | None = None,
                                days_limit: int | None = None) -> list[Path]:
        """Download ONE granule per day — the one closest to ``target_hhmm`` UTC.

        INSAT-3D LST is half-hourly (~48/day); for a daily cube we want a single
        consistent overpass. ~0600 UTC ≈ local late-morning over India (good daytime
        skin temperature). Returns the saved paths. Requires a valid token.
        """
        import pandas as pd

        if not self.access_token:
            self.get_token()
        dest = Path(dest_dir) if dest_dir is not None else self.download_dir()
        dest.mkdir(parents=True, exist_ok=True)
        target_min = int(target_hhmm[:2]) * 60 + int(target_hhmm[2:])

        days = pd.date_range(start, end, freq="D")
        if days_limit is not None:
            days = days[:days_limit]
        saved: list[Path] = []
        for d in days:
            ds = d.strftime("%Y-%m-%d")
            entries = self._day_entries(ds)
            if not entries:
                continue
            # pick the granule whose UTC time is closest to the target overpass
            best = min(
                entries,
                key=lambda e: abs((_hhmm_minutes(e.get("identifier") or "") or 99999) - target_min),
            )
            try:
                p = self.download_granule(best, dest)
                if p is not None:
                    saved.append(p)
            except (MosdacNotReleased, MosdacError):
                continue
        return saved

    # -- helpers ------------------------------------------------------------- #
    @staticmethod
    def _error_message(r: requests.Response) -> str:
        if not _is_json(r):
            return r.text[:200]
        body = r.json()
        # mdapi.py reads resp['error']; search errors use 'message'[0].
        if isinstance(body, dict):
            if "error" in body:
                return str(body["error"])
            if "message" in body:
                m = body["message"]
                return str(m[0] if isinstance(m, list) and m else m)
        return str(body)[:200]


def _is_json(r: requests.Response) -> bool:
    try:
        r.json()
        return True
    except ValueError:
        return False


# --------------------------------------------------------------------------- #
# CLI for quick verification.
# --------------------------------------------------------------------------- #
def main():
    p = argparse.ArgumentParser(description="Native MOSDAC download-API client")
    p.add_argument("--search", action="store_true", help="token + search only (no download)")
    p.add_argument("--download", action="store_true", help="download granules")
    p.add_argument("--limit", type=int, default=None, help="max granules to list/download")
    p.add_argument("--no-auth", action="store_true",
                   help="search without logging in (search is public)")
    p.add_argument("--daily", action="store_true",
                   help="download ONE overpass per day over [--start, --end]")
    p.add_argument("--start", help="daily download start date YYYY-MM-DD")
    p.add_argument("--end", help="daily download end date YYYY-MM-DD")
    p.add_argument("--target", default="0600", help="target UTC overpass HHMM (default 0600)")
    args = p.parse_args()

    if args.daily:
        client = MosdacClient()
        s = args.start or client.cfg["search_parameters"].get("startTime")
        e = args.end or client.cfg["search_parameters"].get("endTime")
        print(f"[mosdac] daily overpass download {s}..{e} target={args.target}Z")
        saved = client.download_daily_overpass(s, e, target_hhmm=args.target,
                                               days_limit=args.limit)
        print(f"[mosdac] downloaded {len(saved)} daily granule(s) -> {client.download_dir()}")
        client.logout()
        return

    client = MosdacClient()
    print(f"[mosdac] datasetId={client.cfg['search_parameters'].get('datasetId')} "
          f"user={client.username!r}")

    if args.search or (not args.download):
        res = client.search()
        print(f"[mosdac] totalResults={res.get('totalResults')} "
              f"itemsPerPage={res.get('itemsPerPage')} totalSizeMB={res.get('totalSizeMB')}")
        if not args.no_auth:
            client.get_token()
            print("[mosdac] login OK")
            gl = client.list_granules(max_records=args.limit or 5)
            for g in gl[:5]:
                print(f"   - {g['identifier']}  ({g['updated']})")
        return

    if args.download:
        saved = client.download_all(limit=args.limit)
        print(f"[mosdac] downloaded {len(saved)} granule(s) -> {client.download_dir()}")
        client.logout()


if __name__ == "__main__":
    main()
