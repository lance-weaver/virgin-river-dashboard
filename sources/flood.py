"""Flood stage and sediment on the Virgin River.

Flood categories are the National Weather Service NWPS gauges, fetched live:
    HURU1  Virgin near Hurricane   (USGS 09408150)
    VIRU1  Virgin near Virgin      (USGS 09406000)
    VLTA3  Virgin at Littlefield   (USGS 09415000)
    https://api.water.noaa.gov/nwps/v1/gauges/{lid}

Sediment is USGS turbidity (parameter 63680, FNU) at 09406000 (Virgin at Virgin) and
09408400 (Santa Clara near Pine Valley). The values themselves are stored with the other
USGS readings in iv/dv; this module reads them and keeps the NWPS snapshot.

The short-range CBRFC hydrograph for Hurricane (HURU1) is served by sources/cbrfc.py.
"""
import datetime as dt
import json

NAME = "flood"
LIDS = ("HURU1", "VIRU1", "VLTA3")
TURB_SITES = {
    "09406000": "Virgin River at Virgin",
    "09408400": "Santa Clara River near Pine Valley",
}
# NWPS floodCategory values, in rising order, and the words to show.
LABELS = {
    "no_flooding": "No flooding",
    "none": "No flooding",
    "action": "Action stage",
    "minor": "Minor flooding",
    "moderate": "Moderate flooding",
    "major": "Major flooding",
}


def init(con):
    con.execute(f"create table if not exists {NAME}_meta (k varchar primary key, v varchar)")


def _slim(d):
    status = d.get("status") or {}
    obs, fc = status.get("observed") or {}, status.get("forecast") or {}
    flood = d.get("flood") or {}
    cats = (flood.get("categories") or {})
    def cat(block):
        if not isinstance(block, dict):
            return None
        return {"stage_ft": block.get("stage"), "flow_cfs": block.get("flow")}
    crests = ((flood.get("crests") or {}).get("historic") or [])[:8]
    return {
        "lid": d.get("lid"),
        "usgs": d.get("usgsId"),
        "name": d.get("name"),
        "lat": d.get("latitude"),
        "lon": d.get("longitude"),
        "wfo": (d.get("wfo") or {}).get("abbreviation"),
        "observed": {"stage_ft": obs.get("primary"), "flow_kcfs": obs.get("secondary"),
                     "category": obs.get("floodCategory"), "valid": obs.get("validTime")},
        "forecast": {"stage_ft": fc.get("primary"), "flow_kcfs": fc.get("secondary"),
                     "category": fc.get("floodCategory"), "valid": fc.get("validTime")},
        "categories": {k: cat(cats.get(k)) for k in ("action", "minor", "moderate", "major")},
        "crests": [{"time": c.get("occurredTime"), "stage_ft": c.get("stage"), "flow_cfs": c.get("flow")} for c in crests],
    }


def refresh(con, fetch):
    init(con)
    kept = []
    errors = []
    for lid in LIDS:
        try:
            kept.append(_slim(fetch(f"https://api.water.noaa.gov/nwps/v1/gauges/{lid}", timeout=60)))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{lid}: {e}")
            print(f"nwps {lid} failed: {e}", flush=True)
    if kept:
        con.execute(f"insert or replace into {NAME}_meta values ('gauges', ?)", [json.dumps(kept)])
        con.execute(f"insert or replace into {NAME}_meta values ('pulled_at', ?)", [dt.datetime.now().isoformat(timespec="minutes")])
    if errors and not kept:
        raise RuntimeError("; ".join(errors))


def _gauges(con):
    r = con.execute(f"select v from {NAME}_meta where k = 'gauges'").fetchone()
    gauges = json.loads(r[0]) if r else []
    for g in gauges:
        for side in ("observed", "forecast"):
            cat = (g.get(side) or {}).get("category")
            g[side]["category_label"] = LABELS.get(cat, cat or "Unknown")
    return gauges


def _turbidity(con, window):
    daily = window["resolution"] != "hourly"
    out = []
    for sid, name in TURB_SITES.items():
        if daily:
            rows = con.execute("""
                select "day", value from dv where site_id = ? and param = '63680'
                and "day" >= ? and "day" <= ? order by 1""", [sid, window["from_day"], window["to_day"]]).fetchall()
            series = [{"t": r[0].isoformat(), "v": round(r[1], 1)} for r in rows]
        else:
            rows = con.execute("""
                select date_trunc('hour', ts) hr, avg(value) v from iv
                where site_id = ? and param = '63680' and ts >= ? and ts < ?
                group by 1 order by 1""",
                [sid, dt.datetime.combine(window["from_day"], dt.time()),
                 dt.datetime.combine(window["to_day"] + dt.timedelta(days=1), dt.time())]).fetchall()
            series = [{"t": r[0].strftime("%Y-%m-%dT%H:%M"), "v": round(r[1], 1)} for r in rows]
        latest = con.execute("""
            select ts, value from iv where site_id = ? and param = '63680' order by ts desc limit 1""", [sid]).fetchone()
        if latest is None:
            latest = con.execute("""
                select "day", value from dv where site_id = ? and param = '63680' order by "day" desc limit 1""", [sid]).fetchone()
        out.append({"site_id": sid, "name": name,
                    "latest_fnu": None if not latest else round(latest[1], 1),
                    "latest_time": None if not latest else str(latest[0])[:19],
                    "series": series})
    return out


def query(con, window):
    init(con)
    return {"gauges": _gauges(con), "turbidity": _turbidity(con, window),
            "note": "Flood categories are NWS stages at the gauge, not a forecast of damage. Turbidity is a stand-in for sediment, in FNU, and it spikes on the same storms that move the bed of the river."}


def history(con):
    init(con)
    crests = []
    for g in _gauges(con):
        for c in g.get("crests") or []:
            crests.append({"lid": g["lid"], "name": g["name"], "usgs": g.get("usgs"), **c})
    return {"crests": crests, "gauges": [{k: g[k] for k in ("lid", "name", "usgs", "categories")} for g in _gauges(con)]}
