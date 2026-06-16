"""Shared HTTP helpers: retry/backoff for the flaky government data endpoints.

ArcGIS, gov.scot and police.uk all throw intermittent 5xx/429s under load, and
some ArcGIS services return errors as HTTP 200 with an {"error": {...}} body or a
truncated/HTML body. These helpers retry all of those so a single blip doesn't
abort a long national fetch.
"""
from __future__ import annotations

import logging
import time

import requests

log = logging.getLogger(__name__)

RETRY_STATUS = (429, 500, 502, 503, 504)


def get_with_retry(
    url: str,
    params: dict | None = None,
    *,
    timeout: int = 120,
    retries: int = 5,
    backoff: float = 2.0,
    stream: bool = False,
    headers: dict | None = None,
) -> requests.Response:
    """GET with exponential backoff on transient HTTP/network errors."""
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=timeout, stream=stream,
                                 headers=headers)
            if resp.status_code in RETRY_STATUS:
                raise requests.exceptions.HTTPError(str(resp.status_code), response=resp)
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as exc:
            if attempt == retries - 1:
                raise
            wait = backoff * (2 ** attempt)
            log.warning("GET %s failed (%s); retry %d/%d in %.0fs",
                        url, exc, attempt + 1, retries - 1, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def get_json_with_retry(
    url: str,
    params: dict | None = None,
    *,
    timeout: int = 120,
    retries: int = 5,
    backoff: float = 2.0,
) -> dict:
    """GET + parse JSON, retrying transient errors, malformed bodies, and the
    ArcGIS-specific case of a 200 response carrying an {"error": {...}} body."""
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            if resp.status_code in RETRY_STATUS:
                raise requests.exceptions.HTTPError(str(resp.status_code), response=resp)
            resp.raise_for_status()
            data = resp.json()  # may raise JSONDecodeError on a malformed body
            if isinstance(data, dict) and "error" in data:
                raise requests.exceptions.HTTPError(f"ArcGIS error: {data['error']}")
            return data
        except (requests.exceptions.RequestException, ValueError) as exc:
            if attempt == retries - 1:
                raise
            wait = backoff * (2 ** attempt)
            log.warning("GET %s failed (%s); retry %d/%d in %.0fs",
                        url, exc, attempt + 1, retries - 1, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def fetch_arcgis_attributes(
    url: str,
    *,
    where: str = "1=1",
    out_fields: str = "*",
    page_size: int = 1000,
    extra_params: dict | None = None,
) -> list[dict]:
    """Page through an ArcGIS query endpoint and return feature attribute dicts.

    Geometry is not requested. ``page_size`` must be <= the endpoint's
    maxRecordCount, or a capped first page looks like the final page.
    """
    rows: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": where,
            "outFields": out_fields,
            "f": "json",
            "returnGeometry": "false",
            "resultOffset": offset,
            "resultRecordCount": page_size,
        }
        if extra_params:
            params.update(extra_params)
        data = get_json_with_retry(url, params)
        features = data.get("features", [])
        if not features:
            break
        rows.extend(f["attributes"] for f in features)
        offset += len(features)
        if len(features) < page_size:
            break
        time.sleep(0.3)
    return rows
