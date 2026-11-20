"""Storage in the reservoirs Washington County operates on the Virgin River.

NRCS Air and Water Database (AWDB), element RESC (reservoir storage, acre-feet), duration MONTHLY.
Daily RESC is not published for these five stations (the daily request returns an empty list), so the
panel is labeled monthly. Capacities come from station metadata (reservoirMetadata.capacity).

Triplets, checked live 2026-11-20:
    09UTQUAI Quail Creek, 09UTSAND Sand Hollow, 09UTGUNL Gunlock, 09UTKOLB Kolob, 09UTIVIN Ivins.

A daily series from WCWCD telemetry can be added later beside this monthly record. Nothing here
pretends the month-end number is today's operations figure.
"""
import datetime as dt

NAME = "reservoirs"
AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1"
START = "1986-01-01"
REFRESH_SEC = 6 * 3600

# id, name, triplet, lat, lon, capacity fallback (acre-feet) from AWDB metadata on 2026-11-20
RES = [
    ("quail", "Quail Creek", "09UTQUAI:UT:BOR", 37.18022, -113.38098, 40000),
    ("sand", "Sand Hollow", "09UTSAND:UT:BOR", 37.11417, -113.37472, 50000),
    ("gunlock", "Gunlock", "09UTGUNL:UT:BOR", 37.25136, -113.77556, 10400),
    ("kolob", "Kolob", "09UTKOLB:UT:BOR", 37.43333, -113.03583, 5600),
    ("ivins", "Ivins", "09UTIVIN:UT:BOR", 37.17875, -113.71329, 1418),
]
BY_ID = {r[0]: r for r in RES}


def init(con):
    con.execute(f"""
        create table if not exists {NAME}_monthly (res_id varchar, month_end date, af double, primary key (res_id, month_end));
        create table if not exists {NAME}_capacity (res_id varchar primary key, capacity_af double, src varchar);
        create table if not exists {NAME}_meta (k varchar primary key, v varchar);""")


def _meta(con, k):
    r = con.execute(f"select v from {NAME}_meta where k = ?", [k]).fetchone()
    return r[0] if r else None


def _meta_set(con, k, v):
    con.execute(f"insert or replace into {NAME}_meta values (?, ?)", [k, v])


def _month_end(year, month):
    if month == 12:
        return dt.date(year, 12, 31)
    return dt.date(year, month + 1, 1) - dt.timedelta(days=1)


def refresh(con, fetch):
    init(con)
    last = _meta(con, "pulled_at")
    if last and (dt.datetime.now() - dt.datetime.fromisoformat(last)).total_seconds() < REFRESH_SEC:
        if con.execute(f"select count(*) from {NAME}_monthly").fetchone()[0]:
            return
    trips = ",".join(r[2] for r in RES)
    try:
        stations = fetch(f"{AWDB}/stations?stationTriplets={trips}&returnReservoirMetadata=true&activeOnly=false", timeout=90)
        cap = {s.get("stationTriplet"): (s.get("reservoirMetadata") or {}).get("capacity") for s in stations or []}
    except Exception as e:  # noqa: BLE001
        print(f"reservoir capacity lookup failed: {e}", flush=True)
        cap = {}
    for rid, _, trip, _, _, fallback in RES:
        live = cap.get(trip)
        con.execute(f"insert or replace into {NAME}_capacity values (?, ?, ?)",
                    [rid, float(live) if live else fallback, "NRCS AWDB station metadata" if live else "NRCS AWDB station metadata, 2026-11-20"])
    # Re-pull the last 18 months every refresh (a month can be revised) and the full record once.
    have = con.execute(f"select count(*) from {NAME}_monthly").fetchone()[0]
    begin = START if not have else (dt.date.today() - dt.timedelta(days=540)).isoformat()
    payload = fetch(f"{AWDB}/data?stationTriplets={trips}&elements=RESC&duration=MONTHLY&beginDate={begin}&endDate={dt.date.today().isoformat()}", timeout=180)
    by_trip = {r[2]: r[0] for r in RES}
    for st in payload or []:
        rid = by_trip.get(st.get("stationTriplet"))
        if not rid:
            continue
        days, vals = [], []
        for el in st.get("data") or []:
            for x in el.get("values") or []:
                if x.get("value") is None:
                    continue
                if x.get("date"):
                    end = dt.date.fromisoformat(x["date"][:10])
                elif x.get("year") and x.get("month"):
                    end = _month_end(int(x["year"]), int(x["month"]))
                else:
                    continue
                days.append(end.isoformat())
                vals.append(float(x["value"]))
        if days:
            con.execute(f"""insert or replace into {NAME}_monthly
                select ?, unnest(?::varchar[])::date, unnest(?::double[])""", [rid, days, vals])
    _meta_set(con, "pulled_at", dt.datetime.now().isoformat(timespec="minutes"))


def _rows(con, where, params):
    return con.execute(f"""
        select m.res_id, m.month_end, m.af, c.capacity_af
        from {NAME}_monthly m left join {NAME}_capacity c using (res_id)
        where {where} order by m.res_id, m.month_end""", params).fetchall()


def _pack(records):
    """records: (res_id, month_end, af, capacity) grouped per reservoir, chronological."""
    latest = {}
    for rid, month_end, af, cap in records:
        latest.setdefault(rid, []).append((month_end, af, cap))
    out = []
    for rid, _, _, lat, lon, _ in RES:
        series = latest.get(rid) or []
        if not series:
            out.append({"id": rid, "name": BY_ID[rid][1], "lat": lat, "lon": lon, "storage_af": None,
                        "capacity_af": None, "pct": None, "month": None, "change_af": None})
            continue
        month_end, af, cap = series[-1]
        prev = series[-2][1] if len(series) > 1 else None
        pct = round(100 * af / cap, 1) if cap else None
        out.append({"id": rid, "name": BY_ID[rid][1], "triplet": BY_ID[rid][2], "lat": lat, "lon": lon,
                    "storage_af": round(af), "capacity_af": round(cap) if cap else None, "pct": pct,
                    "month": month_end.isoformat(), "change_af": None if prev is None else round(af - prev)})
    live = [r for r in out if r["storage_af"] is not None and r["capacity_af"]]
    total_af = sum(r["storage_af"] for r in live)
    total_cap = sum(r["capacity_af"] for r in live)
    return out, {"storage_af": total_af, "capacity_af": total_cap,
                 "pct": round(100 * total_af / total_cap, 1) if total_cap else None, "n": len(live)}


def query(con, window):
    init(con)
    # Short windows still show the seasonal shape: at least the last 36 month-ends, plus anything older the window asks for.
    start = min(window["from_day"], dt.date.today() - dt.timedelta(days=36 * 31))
    if window["days"] > 800:
        start = window["from_day"]
    recs = _rows(con, "m.month_end >= ?", [start])
    reservoirs, total = _pack(recs)
    series = [{"id": rid, "month": month_end.isoformat(), "af": round(af)} for rid, month_end, af, _ in recs]
    as_of = max((r["month"] for r in reservoirs if r["month"]), default=None)
    return {"cadence": "monthly", "as_of": as_of, "reservoirs": reservoirs, "total": total, "series": series,
            "note": ("NRCS publishes end-of-month storage for these reservoirs. Daily storage is not on AWDB. "
                     "The number is the latest month-end, not this morning's reading."),
            "telemetry": "Daily WCWCD telemetry is not connected. This panel leaves room for it beside the monthly record."}


def history(con):
    init(con)
    recs = _rows(con, "true", [])
    reservoirs, total = _pack(recs)
    series = [{"id": rid, "month": month_end.isoformat(), "af": round(af)} for rid, month_end, af, _ in recs]
    return {"reservoirs": reservoirs, "total": total, "series": series, "cadence": "monthly"}
