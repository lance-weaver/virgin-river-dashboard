#!/usr/bin/env python3
"""Virgin River basin water dashboard.

A single Python server: stdlib HTTP plus DuckDB. It pulls USGS gauges, NOAA rain, and the
plug-in sources under sources/, and serves the page in static/.

    python3 server.py                  # http://127.0.0.1:8765  (refreshes hourly)
    python3 server.py --export _site   # static copy for GitHub Pages

The server, the plug-in shape, and the page structure follow Clinton Lunn's gsl-dashboard
(https://github.com/clintonlunn/gsl-dashboard), reused with his permission and retargeted
to the Virgin River for the Washington County Water Conservancy District.

Mainstem, upstream to downstream: 09406000, 09406100, 09408135, 09408150, 09413200, 09413500, 09415000.
Tributaries: 09405500 North Fork, 09404900 East Fork, 09408400 Santa Clara at Pine Valley,
09413000 Santa Clara at St. George, 09408195 Fort Pearce Wash.
Basins: HUC 15010008, 15010009, 15010010. The long record is Littlefield, daily since 1929.
"""
import argparse
import datetime as dt
import gzip
import json
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import duckdb

import sources
from sources._http import fetch

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("VIRGIN_DB", os.path.join(HERE, "virgin.duckdb"))
STATIC = os.path.join(HERE, "static")

# Verified against the USGS site service on 2026-11-20. Roles are fixed: mainstem gauges are a
# profile of one river, not volumes to add together. Littlefield is where the river leaves the
# basin for Lake Mead. Hurricane is the gauge WCWCD operations sit on, just below the Quail Creek reach.
GAUGES = [
    {"site_id": "09405500", "name": "North Fork Virgin River near Springdale, UT", "short": "North Fork", "lat": 37.2097046, "lon": -112.9785512, "role": "tributary", "sort": 1},
    {"site_id": "09404900", "name": "East Fork Virgin River near Springdale, UT", "short": "East Fork", "lat": 37.16414955, "lon": -112.9585499, "role": "tributary", "sort": 2},
    {"site_id": "09406000", "name": "Virgin River at Virgin, UT", "short": "Virgin", "lat": 37.2041494, "lon": -113.1807789, "role": "mainstem", "sort": 1},
    {"site_id": "09406100", "name": "Virgin River above La Verkin Creek near La Verkin, UT", "short": "Above La Verkin", "lat": 37.1969272, "lon": -113.285226, "role": "mainstem", "sort": 2},
    {"site_id": "09408135", "name": "Virgin River above Quail Creek near Hurricane, UT", "short": "Above Quail Creek", "lat": 37.19248238, "lon": -113.3532832, "role": "mainstem", "sort": 3},
    {"site_id": "09408150", "name": "Virgin River near Hurricane, UT", "short": "Hurricane", "lat": 37.16276007, "lon": -113.3952285, "role": "mainstem", "sort": 4},
    {"site_id": "09408400", "name": "Santa Clara River near Pine Valley, UT", "short": "Santa Clara at Pine Valley", "lat": 37.38331325, "lon": -113.483288, "role": "tributary", "sort": 3},
    {"site_id": "09408195", "name": "Fort Pearce Wash near St. George, UT", "short": "Fort Pearce Wash", "lat": 37.00164939, "lon": -113.4688407, "role": "tributary", "sort": 5},
    {"site_id": "09413000", "name": "Santa Clara River at St. George, UT", "short": "Santa Clara at St. George", "lat": 37.07525867, "lon": -113.5930125, "role": "tributary", "sort": 4},
    {"site_id": "09413200", "name": "Virgin River near Bloomington, UT", "short": "Bloomington", "lat": 37.07, "lon": -113.5838889, "role": "mainstem", "sort": 5},
    {"site_id": "09413500", "name": "Virgin River near St. George, UT", "short": "St. George", "lat": 37.0144243, "lon": -113.6805163, "role": "mainstem", "sort": 6},
    {"site_id": "09415000", "name": "Virgin River at Littlefield, AZ", "short": "Littlefield", "lat": 36.8916437, "lon": -113.9244098, "role": "mainstem", "sort": 7},
]
INDEX = "09408150"     # Hurricane, the operations gauge
INTAKE = "09408135"    # above the Quail Creek diversion
OUTLET = "09415000"    # Littlefield, the long record and the basin outlet
HUC = ["15010008", "15010009", "15010010"]
BBOX = [-114.1, 36.85, -112.5, 37.65]
RAIN_BBOX = "-114.1,36.85,-112.5,37.65"
VALLEY_MAX_FT = 5000   # stations below this sit in the valleys; higher ones are mountain sites

HISTORY_START = "1929-01-01"   # Littlefield daily means
DV_START = "1980-01-01"        # other gauges: long enough for a month's normal and the 10-year view
DEFAULT_DAYS = 7
BASELINE_DAYS = 14
HOURLY_MAX_DAYS = 62
IV_START = dt.date(2007, 10, 1)
RAIN_MAX_DAYS = 7305
EVENT_LOOKBACK_DAYS = 120
EVENT_RAIN_IN = 0.25
REFRESH_SEC = 3600

IMAGERY_BBOX = BBOX
IMAGERY_DAYS = 30
IMAGERY_MAX_CLOUD = 20
IMAGERY_REFRESH_SEC = 6 * 3600
PC = "https://planetarycomputer.microsoft.com/api"

lock = threading.Lock()


# ---------------------------------------------------------------- storage

SCHEMA = """
create table if not exists sites (
    site_id varchar primary key, name varchar, short varchar, lat double, lon double, role varchar, sort integer);
create table if not exists iv (
    site_id varchar, param varchar, ts timestamp, value double, primary key (site_id, param, ts));
create table if not exists dv (
    site_id varchar, param varchar, "day" date, value double, primary key (site_id, param, "day"));
create table if not exists rain (
    sid varchar, "day" date, station varchar, lat double, lon double, elev_ft double, pcpn_in double, flag varchar,
    primary key (sid, "day"));
create table if not exists pulled (kind varchar, chunk varchar, primary key (kind, chunk));
create table if not exists meta (k varchar primary key, v varchar);
"""
COLS = {
    "sites": "{site_id: 'VARCHAR', name: 'VARCHAR', short: 'VARCHAR', lat: 'DOUBLE', lon: 'DOUBLE', role: 'VARCHAR', sort: 'INTEGER'}",
    "iv": "{site_id: 'VARCHAR', param: 'VARCHAR', ts: 'TIMESTAMP', value: 'DOUBLE'}",
    "dv": "{site_id: 'VARCHAR', param: 'VARCHAR', day: 'DATE', value: 'DOUBLE'}",
    "rain": ("{sid: 'VARCHAR', day: 'DATE', station: 'VARCHAR', lat: 'DOUBLE', lon: 'DOUBLE', "
             "elev_ft: 'DOUBLE', pcpn_in: 'DOUBLE', flag: 'VARCHAR'}"),
}


def upsert(con, table, rows):
    if not rows:
        return
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
        name = f.name
    try:
        con.execute(f"insert or replace into {table} select * from read_json('{name}', columns={COLS[table]})")
    finally:
        os.unlink(name)


def meta_get(con, k):
    r = con.execute("select v from meta where k = ?", [k]).fetchone()
    return r[0] if r else None


def meta_set(con, k, v):
    con.execute("insert or replace into meta values (?, ?)", [k, v])


def init_db():
    with duckdb.connect(DB_PATH) as con:
        con.execute(SCHEMA)
        for src in sources.ALL:
            if hasattr(src, "init"):
                src.init(con)


# ---------------------------------------------------------------- USGS and rain

def fetch_text(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "virgin-river-dashboard"})

    def read():
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    from sources._http import retrying
    return retrying(read)


def parse_usgs(d, daily):
    rows = []
    for t in d.get("value", {}).get("timeSeries", []):
        site = t["sourceInfo"]["siteCode"][0]["value"]
        param = t["variable"]["variableCode"][0]["value"]
        # Daily requests can return min, mean and max together. 00003 is the mean; 00000 is an
        # instantaneous value (no daily statistic). Drop the other daily statistics.
        opts = (t["variable"].get("options") or {}).get("option") or []
        stat = next((o.get("optionCode") for o in opts if o.get("name") == "Statistic"), None)
        if stat and stat not in ("00003", "00000"):
            continue
        for v in t["values"][0]["value"]:
            try:
                val = float(v["value"])
            except (TypeError, ValueError):
                continue
            if val < -998:
                continue
            key = {"day": v["dateTime"][:10]} if daily else {"ts": v["dateTime"][:19]}
            rows.append({"site_id": site, "param": param, **key, "value": val})
    return rows


def pull_iv(site_ids, start, end, timeout=60):
    url = (f"https://waterservices.usgs.gov/nwis/iv/?format=json&sites={','.join(site_ids)}"
           f"&parameterCd=00060,63680&startDT={start}&endDT={end}")
    return parse_usgs(fetch(url, timeout=timeout), daily=False)


def pull_dv(site_ids, start, end):
    url = (f"https://waterservices.usgs.gov/nwis/dv/?format=json&sites={','.join(site_ids)}"
           f"&parameterCd=00060,63680&statCd=00003&startDT={start}&endDT={end}")
    return parse_usgs(fetch(url, timeout=300), daily=True)


def pull_rain(start, end, timeout=45):
    d = fetch("https://data.rcc-acis.org/MultiStnData", {
        "bbox": RAIN_BBOX, "sdate": start, "edate": end,
        "elems": [{"name": "pcpn"}], "meta": ["name", "sids", "ll", "elev"]}, timeout=timeout)
    s0 = dt.date.fromisoformat(start)
    rows = []
    for s in d.get("data", []):
        m = s.get("meta") or {}
        if "ll" not in m or not m.get("sids"):
            continue
        for i, pair in enumerate(s.get("data") or []):
            v = pair[0] if pair else "M"
            val, flag = None, None
            if v == "T":
                val, flag = 0.0, "trace"
            elif v == "M":
                continue
            elif v == "S":
                flag = "in next report"
            elif isinstance(v, str) and v.endswith("A"):
                val, flag = float(v[:-1]), "multi-day total"
            else:
                try:
                    val = float(v)
                except (TypeError, ValueError):
                    continue
            rows.append({"sid": m["sids"][0].split()[0], "day": (s0 + dt.timedelta(i)).isoformat(),
                         "station": m.get("name", "").title(), "lat": m["ll"][1], "lon": m["ll"][0],
                         "elev_ft": m.get("elev"), "pcpn_in": val, "flag": flag})
    return rows


def pull_imagery():
    """Least-cloudy Sentinel-2 mosaic for the basin, as a tile URL."""
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(days=IMAGERY_DAYS)
    span = [f"{start:%Y-%m-%dT%H:%M:%SZ}", f"{end:%Y-%m-%dT%H:%M:%SZ}"]
    w, s, e, n = IMAGERY_BBOX
    filt = {"op": "and", "args": [
        {"op": "s_intersects", "args": [{"property": "geometry"},
                                        {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}]},
        {"op": "anyinteracts", "args": [{"property": "datetime"}, {"interval": span}]},
        {"op": "<", "args": [{"property": "eo:cloud_cover"}, IMAGERY_MAX_CLOUD]}]}
    reg = fetch(f"{PC}/data/v1/mosaic/register", {"collections": ["sentinel-2-l2a"], "filter-lang": "cql2-json",
                                                  "filter": filt, "sortby": [{"field": "eo:cloud_cover", "direction": "asc"}]}, timeout=40)
    scenes = fetch(f"{PC}/stac/v1/search", {"collections": ["sentinel-2-l2a"], "bbox": IMAGERY_BBOX, "datetime": "/".join(span),
                                           "query": {"eo:cloud_cover": {"lt": IMAGERY_MAX_CLOUD}}, "limit": 100,
                                           "fields": {"include": ["properties.datetime"], "exclude": ["assets", "links", "geometry"]}}, timeout=40)
    days = sorted({f["properties"]["datetime"][:10] for f in scenes.get("features", [])})
    if not days:
        return None
    return {"tiles": f"{PC}/data/v1/mosaic/{reg['searchid']}/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}@1x"
                     "?collection=sentinel-2-l2a&assets=visual&nodata=0&format=png",
            "newest": days[-1], "oldest": days[0], "scenes": len(scenes["features"])}


def months(a, b):
    out, d = [], dt.date(a.year, a.month, 1)
    while d <= b:
        nxt = dt.date(d.year + d.month // 12, d.month % 12 + 1, 1)
        out.append((d, min(nxt - dt.timedelta(days=1), b)))
        d = nxt
    return out


def ensure_iv(con, start, end):
    """15-minute readings, a month at a time and a few gauges at a time. One big request stalls."""
    ids = [g["site_id"] for g in GAUGES]
    have = {r[0] for r in con.execute("select chunk from pulled where kind = 'iv'").fetchall()}
    for a, _b in months(max(start, IV_START), end):
        key = f"{a:%Y-%m}"
        if key in have:
            continue
        nxt = dt.date(a.year + a.month // 12, a.month % 12 + 1, 1)
        print(f"instantaneous {key}", flush=True)
        ok = True
        for i in range(0, len(ids), 4):
            try:
                upsert(con, "iv", pull_iv(ids[i:i + 4], a.isoformat(), nxt.isoformat()))
            except Exception as e:  # noqa: BLE001
                print(f"instantaneous {key} {ids[i]} failed: {e}", flush=True)
                ok = False
        if ok:
            con.execute("insert or replace into pulled values ('iv', ?)", [key])


def ensure_dv(con):
    """Full daily means once per gauge, then a short overlap so recent days pick up revisions."""
    have = {r[0] for r in con.execute("select chunk from pulled where kind = 'dv'").fetchall()}
    today = dt.date.today().isoformat()
    for g in GAUGES:
        sid = g["site_id"]
        if sid in have:
            continue
        start = HISTORY_START if sid == OUTLET else DV_START
        print(f"daily record {sid} ({g['short']}) from {start}", flush=True)
        try:
            upsert(con, "dv", pull_dv([sid], start, today))
        except Exception as e:  # noqa: BLE001
            print(f"daily {sid} failed: {e}", flush=True)
            continue
        con.execute("insert or replace into pulled values ('dv', ?)", [sid])
    recent = (dt.date.today() - dt.timedelta(days=45)).isoformat()
    ids = [g["site_id"] for g in GAUGES]
    for i in range(0, len(ids), 6):
        try:
            upsert(con, "dv", pull_dv(ids[i:i + 6], recent, today))
        except Exception as e:  # noqa: BLE001
            print(f"daily refresh failed: {e}", flush=True)


def _pull_rain_span(start, end):
    """One ACIS call, or four quarters if that call stalls. A full year of this basin is small, but ACIS sometimes holds the socket open."""
    try:
        return pull_rain(start.isoformat(), end.isoformat())
    except Exception as e:  # noqa: BLE001
        if (end - start).days < 100:
            raise
        print(f"rain {start}..{end} failed ({e}); splitting", flush=True)
        rows, cursor = [], start
        while cursor <= end:
            nxt = min(cursor + dt.timedelta(days=90), end)
            rows += pull_rain(cursor.isoformat(), nxt.isoformat())
            cursor = nxt + dt.timedelta(days=1)
        return rows


def ensure_rain(con, start, end):
    have = {r[0] for r in con.execute("select chunk from pulled where kind = 'rain'").fetchall()}
    today = dt.date.today()
    fresh = con.execute('select max("day") from rain').fetchone()[0]
    for y in range(start.year, end.year + 1):
        if str(y) in have and y < today.year:
            continue
        # The current year is re-checked at the end of refresh (last few days). Don't download it
        # all over again when those days are already stored; ACIS sometimes accepts the socket and never answers.
        if y == today.year and fresh and fresh >= today - dt.timedelta(days=2):
            continue
        print(f"rain {y}", flush=True)
        y0, y1 = dt.date(y, 1, 1), min(dt.date(y, 12, 31), today)
        try:
            rows = _pull_rain_span(y0, y1)
        except Exception as e:  # noqa: BLE001
            print(f"rain {y} failed: {e}", flush=True)
            continue
        upsert(con, "rain", rows)
        # The current year is still filing reports, so it is pulled again next time. Past years stay cached.
        if y < today.year:
            con.execute("insert or replace into pulled values ('rain', ?)", [str(y)])


def missing(con, kind, start, end):
    have = {r[0] for r in con.execute("select chunk from pulled where kind = ?", [kind]).fetchall()}
    if kind == "iv":
        want = [f"{a:%Y-%m}" for a, _ in months(max(start, IV_START), end)]
    else:
        today = dt.date.today()
        want = [str(y) for y in range(start.year, end.year + 1) if y < today.year]
    return any(w not in have for w in want)


def refresh():
    """Pull anything new, and re-pull the last few days (provisional readings get revised)."""
    today = dt.date.today()
    with lock, duckdb.connect(DB_PATH) as con:
        upsert(con, "sites", GAUGES)
        ensure_dv(con)
        # Hourly series are only used for periods up to two months, so a bit more than that is enough.
        ensure_iv(con, today - dt.timedelta(days=HOURLY_MAX_DAYS + BASELINE_DAYS + 5), today)
        ensure_rain(con, today - dt.timedelta(days=EVENT_LOOKBACK_DAYS + BASELINE_DAYS), today)
        recent = today - dt.timedelta(days=3)
        try:
            upsert(con, "iv", pull_iv([g["site_id"] for g in GAUGES], recent.isoformat(), (today + dt.timedelta(days=1)).isoformat(), timeout=25))
        except Exception as e:  # noqa: BLE001
            print(f"recent instantaneous failed: {e}", flush=True)
        try:
            upsert(con, "rain", pull_rain(recent.isoformat(), today.isoformat(), timeout=20))
        except Exception as e:  # noqa: BLE001
            print(f"recent rain failed: {e}", flush=True)
        meta_set(con, "last_pull_day", today.isoformat())
        meta_set(con, "refreshed_at", dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
        for src in sources.ALL:
            try:
                src.refresh(con, fetch)
            except Exception as e:  # noqa: BLE001
                print(f"source {src.NAME} refresh failed: {e}", flush=True)
        img = json.loads(meta_get(con, "imagery") or "{}")
        if time.time() - img.get("fetched", 0) > IMAGERY_REFRESH_SEC:
            try:
                new = pull_imagery()
                if new:
                    meta_set(con, "imagery", json.dumps({**new, "fetched": time.time()}))
            except Exception as e:  # noqa: BLE001
                print(f"imagery refresh failed: {e}", flush=True)
    print("refreshed", flush=True)


# ---------------------------------------------------------------- queries

def _vol_sql(hourly):
    if hourly:
        src = """select site_id, date_trunc('hour', ts) hr, avg(value) cfs
                 from iv where param = '00060' and ts >= $from and ts < $to group by all"""
        base = """select site_id, median(cfs) baseline_cfs from (
                      select site_id, date_trunc('hour', ts) hr, avg(value) cfs from iv
                      where param = '00060' and ts >= $base_from and ts < $from group by all) group by site_id"""
    else:
        src = """select site_id, "day"::timestamp hr, value cfs
                 from dv where param = '00060' and "day" >= $from_day and "day" <= $to_day"""
        base = """select site_id, median(value) baseline_cfs from dv
                  where param = '00060' and "day" >= $base_from::date and "day" < $from_day group by site_id"""
    return f"""
        with h as ({src}), b as ({base})
        select h.site_id, round(any_value(b.baseline_cfs), 1) baseline_cfs, round(max(h.cfs), 1) peak_cfs,
               round(arg_max(h.cfs, h.hr), 1) latest_cfs, round(avg(h.cfs), 1) mean_cfs,
               round(sum(h.cfs) * $step_af) window_af,
               case when any_value(b.baseline_cfs) is null then null
                    else round(sum(h.cfs - b.baseline_cfs) * $step_af) end excess_af,
               count(*) readings
        from h left join b using (site_id) group by h.site_id"""


def _series_sql(res):
    if res == "hourly":
        src = """select site_id, date_trunc('hour', ts) hr, avg(value) cfs
                 from iv where param = '00060' and ts >= $base_from and ts < $to group by all"""
        fmt = "%Y-%m-%dT%H:00"
    elif res == "weekly":
        src = """select site_id, date_trunc('week', "day")::timestamp hr, avg(value) cfs
                 from dv where param = '00060' and "day" >= $base_from::date and "day" < $to::date group by all"""
        fmt = "%Y-%m-%dT00:00"
    else:
        src = """select site_id, "day"::timestamp hr, value cfs
                 from dv where param = '00060' and "day" >= $base_from::date and "day" < $to::date"""
        fmt = "%Y-%m-%dT00:00"
    return f"""select site_id, strftime(hr, '{fmt}') "hour", round(cfs, 1) cfs, hr >= $from in_window
               from ({src}) order by site_id, hr"""


def _common_sql():
    return {
        "sites": "select * from sites order by case role when 'mainstem' then 0 else 1 end, sort",
        "by_site": """
            select s.site_id, s.name, s.short, s.role, s.lat, s.lon, s.sort,
                   v.baseline_cfs, v.peak_cfs, v.latest_cfs, v.mean_cfs, v.window_af, v.excess_af, v.readings
            from sites s left join vol v using (site_id)
            order by case s.role when 'mainstem' then 0 else 1 end, s.sort""",
        "rain_stations": """
            with last as (select max("day") d from rain),
                 span as (select greatest(least($to_day, (select d from last)) - $from_day + 1, 1) n),
                 w as (select * from rain where "day" >= $from_day and "day" <= least($rain_to, (select d from last)))
            select station, sid, any_value(lat) lat, any_value(lon) lon, any_value(elev_ft) elev_ft,
                   round(coalesce(sum(pcpn_in), 0), 2) total_in, count(pcpn_in) reports, (select n from span) days_expected,
                   (any_value(elev_ft) < $valley
                    and count(pcpn_in) >= greatest((select n from span) - 1, ceil((select n from span) * 0.9))) counted
            from w group by station, sid order by total_in desc""",
        "rain_basin": """
            select round(median(total_in), 2) rain_in, count(*) stations from rain_stations where counted""",
        "events": """
            with d as (select "day", median(pcpn_in) med from rain
                       where elev_ft < $valley and pcpn_in is not null and "day" >= current_date - $lookback::int group by 1),
                 wet as (select "day", med, "day" - (row_number() over (order by "day"))::int grp from d where med >= $event_in)
            select min("day") start_day, max("day") end_day, round(sum(med), 2) rain_in
            from wet group by grp order by start_day desc""",
        "usual_month": """
            select site_id, round(median(value), 1) median_cfs, count(*) n
            from dv where param = '00060' and site_id in ($index, $outlet) and month("day") = $month
            group by site_id""",
    }


def run(con, queries, params):
    out = {}
    for name, sql in queries.items():
        used = {k: v for k, v in params.items() if re.search(rf"\${k}\b", sql)}
        con.execute(f"create or replace temp table {name} as {sql}", used)
        rel = con.execute(f"select * from {name}")
        cols = [c[0] for c in rel.description]
        out[name] = [dict(zip(cols, r)) for r in rel.fetchall()]
    return out


def parse_window(qs):
    today = dt.date.today()
    try:
        to_day = dt.date.fromisoformat(qs["to"][0]) if qs.get("to") else today
        from_day = dt.date.fromisoformat(qs["from"][0]) if qs.get("from") else to_day - dt.timedelta(days=DEFAULT_DAYS - 1)
    except ValueError as e:
        raise ValueError("Dates must look like 2026-10-10") from e
    to_day = min(to_day, today)
    if from_day > to_day:
        raise ValueError("The start date is after the end date")
    if from_day < dt.date.fromisoformat(HISTORY_START):
        raise ValueError("The Littlefield daily record used here starts in 1929")
    return from_day, to_day


def _params(from_day, to_day, res):
    days = (to_day - from_day).days + 1
    base_from = from_day - dt.timedelta(days=BASELINE_DAYS)
    midnight = lambda d: dt.datetime.combine(d, dt.time())  # noqa: E731
    return days, {
        "from": midnight(from_day), "to": midnight(to_day + dt.timedelta(days=1)), "base_from": midnight(base_from),
        "from_day": from_day, "to_day": to_day, "valley": VALLEY_MAX_FT,
        "lookback": EVENT_LOOKBACK_DAYS, "event_in": EVENT_RAIN_IN,
        "step_af": (1 if res == "hourly" else 24) / 12.1,
        "index": INDEX, "outlet": OUTLET, "month": to_day.month,
        "rain_to": to_day if days <= RAIN_MAX_DAYS else from_day - dt.timedelta(days=1),
    }


def _window_payload(con, from_day, to_day, res, params):
    queries = {"vol": _vol_sql(res == "hourly"), "flow_series": _series_sql(res), **_common_sql()}
    # vol has to exist before by_site, and rain_stations before rain_basin. Dict order is insertion order.
    ordered = {}
    for key in ("vol", "flow_series", "sites", "by_site", "rain_stations", "rain_basin", "events", "usual_month"):
        ordered[key] = queries[key]
    return run(con, ordered, params)


def query_window(from_day, to_day):
    days = (to_day - from_day).days + 1
    base_from = from_day - dt.timedelta(days=BASELINE_DAYS)
    res = "hourly" if days <= HOURLY_MAX_DAYS and base_from >= IV_START else ("weekly" if days > 500 else "daily")
    # 15-minute readings are filled by refresh() for the last couple of months. An older window, such as a
    # rain event from the summer, uses daily means instead of downloading that month on the spot.
    with duckdb.connect(DB_PATH) as con:
        if res == "hourly" and missing(con, "iv", base_from, to_day):
            res = "daily"
        need_rain = days <= RAIN_MAX_DAYS and missing(con, "rain", from_day, to_day)
    if need_rain:
        with lock, duckdb.connect(DB_PATH) as con:
            ensure_rain(con, from_day, to_day)
    days, params = _params(from_day, to_day, res)
    with duckdb.connect(DB_PATH) as con:
        out = _window_payload(con, from_day, to_day, res, params)
        if res == "hourly" and not any(r["cfs"] is not None for r in out["flow_series"]):
            res = "daily"
            days, params = _params(from_day, to_day, res)
            out = _window_payload(con, from_day, to_day, res, params)
        out["refreshed_at"] = meta_get(con, "refreshed_at")
        img = meta_get(con, "imagery")
        out["imagery"] = json.loads(img) if img else None
        out["sources"] = {}
        window = {"from_day": from_day, "to_day": to_day, "days": days, "resolution": res}
        for src in sources.ALL:
            try:
                out["sources"][src.NAME] = src.query(con, window)
            except Exception as e:  # noqa: BLE001
                print(f"source {src.NAME} query failed: {e}", flush=True)
                out["sources"][src.NAME] = {"error": str(e)}
    out["window"] = {"from": from_day.isoformat(), "to": to_day.isoformat(), "days": days, "resolution": res,
                     "is_default": to_day == dt.date.today() and days == DEFAULT_DAYS}
    out["config"] = {"baseline_days": BASELINE_DAYS, "default_days": DEFAULT_DAYS, "valley_max_ft": VALLEY_MAX_FT,
                     "event_rain_in": EVENT_RAIN_IN, "hourly_max_days": HOURLY_MAX_DAYS, "rain_max_days": RAIN_MAX_DAYS,
                     "history_start": HISTORY_START, "index_site": INDEX, "intake_site": INTAKE, "outlet_site": OUTLET,
                     "hucs": HUC, "bbox": BBOX}
    return out


def query_history():
    with duckdb.connect(DB_PATH) as con:
        out = run(con, {
            "littlefield_monthly": """
                select strftime(date_trunc('month', "day"), '%Y-%m-%d') "month", round(avg(value), 1) cfs, count(*) n
                from dv where site_id = $outlet and param = '00060' group by 1 order by 1""",
            "annual": """
                select year("day" + interval 3 month) water_year, round(sum("value") * 1.9835) acre_ft,
                       count(*) "days", round(avg("value"), 1) mean_cfs
                from dv where site_id = $outlet and param = '00060'
                group by 1 having count(*) >= 300 order by 1""",
        }, {"outlet": OUTLET})
        rec = con.execute("""
            select max("value"), arg_max("day", "value"), min("day"), max("day"), count(*)
            from dv where site_id = ? and param = '00060'""", [OUTLET]).fetchone()
        out["sources"] = {}
        for src in sources.ALL:
            if hasattr(src, "history"):
                try:
                    out["sources"][src.NAME] = src.history(con)
                except Exception as e:  # noqa: BLE001
                    print(f"source {src.NAME} history failed: {e}", flush=True)
                    out["sources"][src.NAME] = {"error": str(e)}
    out["config"] = {"history_start": HISTORY_START, "outlet_site": OUTLET,
                     "record_high_cfs": None if not rec or rec[0] is None else round(rec[0], 1),
                     "record_high_day": None if not rec or rec[1] is None else rec[1].isoformat(),
                     "record_start": None if not rec or rec[2] is None else rec[2].isoformat(),
                     "record_end": None if not rec or rec[3] is None else rec[3].isoformat(),
                     "record_days": 0 if not rec else rec[4]}
    return out


# ---------------------------------------------------------------- server

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def send_json(self, obj, code=200):
        body = json.dumps(obj, default=str, separators=(",", ":")).encode()
        gz = "gzip" in self.headers.get("Accept-Encoding", "") and len(body) > 1024
        if gz:
            body = gzip.compress(body, 6)
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        try:
            if url.path == "/api/data":
                return self.send_json(query_window(*parse_window(urllib.parse.parse_qs(url.query))))
            if url.path == "/api/history":
                return self.send_json(query_history())
            if url.path == "/api/panels":
                return self.send_json(sorted(f for f in os.listdir(os.path.join(STATIC, "panels")) if f.endswith(".js")))
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": str(e)}, 500)
        self.path = url.path
        return super().do_GET()

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self):
        if self.path == "/api/refresh":
            try:
                refresh()
                return self.send_json({"ok": True})
            except Exception as e:  # noqa: BLE001
                return self.send_json({"error": str(e)}, 502)
        self.send_error(404)

    def log_message(self, fmt, *args):
        if "/api/" not in self.path:
            super().log_message(fmt, *args)


def refresher():
    while True:
        try:
            refresh()
        except Exception as e:  # noqa: BLE001
            print(f"refresh failed: {e}", flush=True)
        time.sleep(REFRESH_SEC)


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, default=str, separators=(",", ":"))


def export(out_dir):
    """A server-free copy: the static files plus one JSON file per preset period."""
    refresh()
    today = dt.date.today()
    shutil.rmtree(out_dir, ignore_errors=True)
    shutil.copytree(STATIC, out_dir)
    data = os.path.join(out_dir, "data")
    panels = sorted(f for f in os.listdir(os.path.join(STATIC, "panels")) if f.endswith(".js"))
    dump(os.path.join(data, "panels.json"), panels)
    dump(os.path.join(data, "history.json"), query_history())
    wanted = [(today - dt.timedelta(days=n - 1), today) for n in (7, 30, 365, 3652)]
    first = query_window(*wanted[0])
    for e in (first.get("events") or [])[:6]:
        s, t = dt.date.fromisoformat(str(e["start_day"])[:10]), dt.date.fromisoformat(str(e["end_day"])[:10])
        wanted.append((s - dt.timedelta(days=1), min(t + dt.timedelta(days=1), today)))
    windows = []
    for a, b in dict.fromkeys(wanted):
        out = first if (a, b) == wanted[0] else query_window(a, b)
        rel = f"data/window/{a}_{b}.json"
        dump(os.path.join(out_dir, rel), out)
        windows.append({"from": a.isoformat(), "to": b.isoformat(), "file": rel})
        print(f"exported {rel}", flush=True)
    manifest = {"today": today.isoformat(), "built_at": dt.datetime.now().isoformat(timespec="minutes"), "windows": windows}
    dump(os.path.join(data, "manifest.json"), {"built_at": manifest["built_at"]})
    ver = "?v=" + urllib.parse.quote(manifest["built_at"])
    for name in os.listdir(os.path.join(out_dir, "js")):
        path = os.path.join(out_dir, "js", name)
        with open(path) as f:
            code = f.read()
        with open(path, "w") as f:
            f.write(re.sub(r"""(from\s+'\./[\w./-]+\.js)'""", lambda m: f"{m.group(1)}{ver}'", code))
    index = os.path.join(out_dir, "index.html")
    with open(index) as f:
        html = f.read()
    html = html.replace('src="js/main.js"', f'src="js/main.js{ver}"')
    html = re.sub(r'href="(css/[\w.-]+\.css)"', lambda m: f'href="{m.group(1)}{ver}"', html)
    tag = f"<script>window.VRD_STATIC = {json.dumps(manifest)};</script>"
    with open(index, "w") as f:
        f.write(html.replace("</head>", f"{tag}\n</head>", 1))
    open(os.path.join(out_dir, ".nojekyll"), "w").close()


def main():
    ap = argparse.ArgumentParser(description="Virgin River basin water dashboard")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--export", metavar="DIR", help="write a static copy for GitHub Pages to DIR and exit")
    args = ap.parse_args()
    init_db()
    if args.export:
        return export(args.export)
    threading.Thread(target=refresher, daemon=True).start()
    print(f"serving http://{args.host}:{args.port}", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
