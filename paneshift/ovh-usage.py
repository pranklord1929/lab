#!/usr/bin/env python3
"""Read-only OVHcloud Public Cloud month-to-date usage and forecast."""

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def request(path: str):
    endpoint = os.environ.get("OVH_API_ENDPOINT", "https://eu.api.ovh.com/1.0").rstrip("/")
    app_key = os.environ["OVH_APPLICATION_KEY"]
    app_secret = os.environ["OVH_APPLICATION_SECRET"]
    consumer_key = os.environ["OVH_CONSUMER_KEY"]
    url = endpoint + path
    timestamp = str(int(time.time()) + int(os.environ.get("OVH_TIME_DELTA", "0")))
    signature = "$1$" + hashlib.sha1(
        (app_secret + "+" + consumer_key + "+GET+" + url + "+" + "+" + timestamp).encode()
    ).hexdigest()
    req = urllib.request.Request(url, headers={
        "X-Ovh-Application": app_key,
        "X-Ovh-Consumer": consumer_key,
        "X-Ovh-Signature": signature,
        "X-Ovh-Timestamp": timestamp,
    })
    with urllib.request.urlopen(req, timeout=8) as response:
        return json.load(response)


def money(payload):
    candidate = payload.get("totalUsage") if isinstance(payload, dict) else None
    if not isinstance(candidate, dict):
        return None
    value = candidate.get("value")
    currency = candidate.get("currencyCode", "EUR")
    if not isinstance(value, (int, float)):
        return None
    return float(value), str(currency)


def main():
    required = ("OVH_APPLICATION_KEY", "OVH_APPLICATION_SECRET", "OVH_CONSUMER_KEY", "OVH_CLOUD_PROJECT")
    if any(not os.environ.get(name) for name in required):
        print("unconfigured")
        return 0
    project = urllib.parse.quote(os.environ["OVH_CLOUD_PROJECT"], safe="")
    try:
        current = money(request(f"/cloud/project/{project}/usage/current"))
        forecast = money(request(f"/cloud/project/{project}/usage/forecast"))
    except (KeyError, OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError):
        print("unavailable")
        return 0
    if not current or not forecast or current[1] != forecast[1]:
        print("unavailable")
        return 0
    print(f"ok\t{current[0]:.2f}\t{forecast[0]:.2f}\t{current[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
