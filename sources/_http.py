"""HTTP helpers for public agency APIs.

Those servers drop connections mid-response now and then, and sometimes accept the socket
and then never send a body. urllib's timeout does not always fire in that second case, so each
attempt also has a wall-clock limit on a daemon thread. Retry the drop, a 429, and a 5xx.
A firm 4xx is the server's answer and is not retried.
"""
import http.client
import json
import threading
import time
import urllib.error
import urllib.request

UA = "virgin-river-dashboard"


def _within(fn, timeout):
    box = {}

    def run():
        try:
            box["value"] = fn()
        except Exception as e:  # noqa: BLE001
            box["error"] = e

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise TimeoutError(f"no response in {timeout}s")
    if "error" in box:
        raise box["error"]
    return box.get("value")


def retrying(read, timeout, tries=3):
    for n in range(tries):
        try:
            return _within(read, timeout)
        except urllib.error.HTTPError as e:
            if (e.code < 500 and e.code != 429) or n == tries - 1:
                raise
        except (http.client.IncompleteRead, http.client.RemoteDisconnected, urllib.error.URLError, TimeoutError, ConnectionError):
            if n == tries - 1:
                raise
        time.sleep(2 * 2 ** n)


def fetch(url, body=None, timeout=180):
    """GET, or POST JSON when body is given. Returns parsed JSON."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json", "User-Agent": UA,
        "Accept": "application/json, application/vnd.api+json, text/csv, */*",
    })

    def read():
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    return retrying(read, timeout)


def fetch_text(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/csv, text/plain, */*"})

    def read():
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    return retrying(read, timeout)
