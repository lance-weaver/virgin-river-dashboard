"""Colorado Basin River Forecast Center products for the Virgin River (area code VG).

Two public products, no key:

* Official seasonal water supply (April-July runoff volume, thousand acre-feet), issued the 1st of
  January through June. One CSV for the whole area:
      https://www.cbrfc.noaa.gov/wsup/graph/wsocond_data.py?fdate=YYYY-MM-01&area=VG&otype=csv
  On 2026-11-20 the area has two points: VIRU1 (Virgin at Virgin) and STCU1 (Santa Clara near Pine Valley).
  The most recent issue in November is the previous June, because the next season's first issue is January.

* Short-range deterministic flow forecast at Hurricane, about 10 days, hourly cfs, with the flood levels
  CBRFC carries for that point:
      https://www.cbrfc.noaa.gov/dbdata/station/flowgraph/flowgraph_data_hc.py?id=HURU1&...

Exceedance: a 90% volume is one the river should beat 9 years in 10. Volumes are thousand acre-feet.
"""
import datetime as dt
import json

from sources._http import fetch_text

NAME = "cbrfc"
BASE = "https://www.cbrfc.noaa.gov"
AREA = "VG"
FLOW_ID = "HURU1"
REFRESH_SEC = 6 * 3600


def init(con):
    con.execute(f"""
        create table if not exists {NAME}_meta (k varchar primary key, v varchar);
        create table if not exists {NAME}_wso (
            issued date, id varchar, river varchar, loc varchar, period varchar,
            p90 double, p70 double, p50 double, p30 double, p10 double,
            avg double, med double, pct_avg double, pct_med double,
            primary key (issued, id));""")


def _meta_set(con, k, v):
    con.execute(f"insert or replace into {NAME}_meta values (?, ?)", [k, v])


def _num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def wso_url(day):
    return f"{BASE}/wsup/graph/wsocond_data.py?fdate={day:%Y-%m-%d}&area={AREA}&otype=csv"


def flow_url(pid=FLOW_ID):
    return (f"{BASE}/dbdata/station/flowgraph/flowgraph_data_hc.py?id={pid}&ptype=1&show_peaks=0&show_daily=0"
            "&show_stats=1&show_ens=0&show_ens_high=0&zero_flow=1&linear_flow=1&legend=0&popup=0&show_title=0")


def parse_wso(text, issued):
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < 2 or "NWS_ID" not in lines[0]:
        return []
    head = [h.strip() for h in lines[0].split(",")]
    out = []
    for line in lines[1:]:
        f = line.split(",")
        if len(f) < len(head):
            continue
        r = dict(zip(head, f))
        if not r.get("NWS_ID"):
            continue
        out.append({"issued": issued.isoformat(), "id": r["NWS_ID"].strip(), "river": r.get("River", "").strip(),
                    "loc": r.get("Location", "").strip(), "period": r.get("Forecast_Period", "").strip(),
                    "p90": _num(r.get("Min_90")), "p70": _num(r.get("P_70")), "p50": _num(r.get("MP_50")),
                    "p30": _num(r.get("P_30")), "p10": _num(r.get("Max_10")), "avg": _num(r.get("Avg")),
                    "med": _num(r.get("Med")), "pct_avg": _num(r.get("Pct_Avg")), "pct_med": _num(r.get("Pct_Med"))})
    return out


def _thin(pairs, step_hours=3):
    """Hourly pairs [[iso, cfs], ...] down to every `step_hours` hours, dropping nulls. Keep the last point."""
    kept = []
    for i, (ts, cfs) in enumerate(pairs):
        if cfs is None:
            continue
        if i % step_hours == 0 or i == len(pairs) - 1:
            kept.append({"t": ts[:19], "cfs": round(float(cfs), 1)})
    return kept


def _flow_blob(payload):
    hc = payload.get("hcdata") or {}
    crit = payload.get("critical") or {}
    return {"id": payload.get("id") or FLOW_ID,
            "name": "Virgin River near Hurricane",
            "usgs": "09408150",
            "issued": payload.get("fdateline") or payload.get("fcdate"),
            "observed": _thin(hc.get("observed_flow") or [], 3),
            "forecast": _thin(hc.get("forecast_flow") or [], 3),
            "critical": {"action_cfs": crit.get("actionf"), "flood_cfs": crit.get("floodf"),
                         "moderate_cfs": crit.get("modfloodf"), "major_cfs": crit.get("majfloodf"),
                         "action_ft": crit.get("action"), "flood_ft": crit.get("flood")}}


def refresh(con, fetch):
    init(con)
    today = dt.date.today()
    # January-June issues for the last three calendar years, plus this year. Missing months are normal
    # (the product is only published in those six months, and a future month 404s).
    for year in range(today.year - 2, today.year + 1):
        for month in range(1, 7):
            day = dt.date(year, month, 1)
            if day > today:
                continue
            try:
                rows = parse_wso(fetch_text(wso_url(day), timeout=45), day)
            except Exception as e:  # noqa: BLE001
                print(f"cbrfc WSO {day} skipped: {e}", flush=True)
                continue
            for r in rows:
                con.execute(f"""insert or replace into {NAME}_wso values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            [r["issued"], r["id"], r["river"], r["loc"], r["period"], r["p90"], r["p70"], r["p50"],
                             r["p30"], r["p10"], r["avg"], r["med"], r["pct_avg"], r["pct_med"]])
    try:
        blob = _flow_blob(fetch(flow_url(), timeout=90))
        _meta_set(con, "flow", json.dumps(blob))
    except Exception as e:  # noqa: BLE001
        print(f"cbrfc flowgraph HURU1 failed: {e}", flush=True)
    _meta_set(con, "pulled_at", dt.datetime.now().isoformat(timespec="minutes"))


def _issues(con):
    rows = con.execute(f"""select issued, id, river, loc, period, p90, p70, p50, p30, p10, avg, med, pct_avg, pct_med
                           from {NAME}_wso order by issued, id""").fetchall()
    grouped = {}
    for issued, pid, river, loc, period, p90, p70, p50, p30, p10, avg, med, pct_avg, pct_med in rows:
        key = issued.isoformat()
        grouped.setdefault(key, {"issued": key, "period": period, "water_year": issued.year if issued.month < 10 else issued.year + 1,
                                 "points": []})
        grouped[key]["points"].append({"id": pid, "river": river, "location": loc,
                                       "name": f"{river} at {loc}".replace("  ", " "),
                                       "p90": p90, "p70": p70, "p50": p50, "p30": p30, "p10": p10,
                                       "avg": avg, "med": med, "pct_avg": pct_avg, "pct_med": pct_med, "period": period})
    return [grouped[k] for k in sorted(grouped)]


def query(con, window):
    init(con)
    issues = _issues(con)
    latest = issues[-1] if issues else None
    flow = {}
    r = con.execute(f"select v from {NAME}_meta where k = 'flow'").fetchone()
    if r:
        flow = json.loads(r[0])
    note = None
    if latest:
        issued = dt.date.fromisoformat(latest["issued"])
        # The April-July forecast is stale once that season is over and the next January issue is not out.
        if window["to_day"] > dt.date(issued.year, 7, 31) and window["to_day"].month >= 8:
            note = (f"The latest official April–July forecast was issued {issued.isoformat()}. "
                    "CBRFC's next official Virgin River issue is the following January.")
    return {"area": AREA, "latest": latest, "issues": issues, "flow": flow, "note": note,
            "links": {"discussion": f"{BASE}/wsup/pub2/discussion/current.pdf",
                      "point": f"{BASE}/wsup/graph/espgraph_hc.html?id={{id}}&year={{wy}}",
                      "flow": f"{BASE}/dbdata/station/flowgraph/flowgraph_hc.html?id=HURU1&ptype=1"}}


def history(con):
    return query(con, {"from_day": dt.date(1929, 1, 1), "to_day": dt.date.today(), "days": 99999, "resolution": "daily"})
