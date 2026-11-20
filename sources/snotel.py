"""Snow water equivalent at the five SNOTEL stations that frame the Virgin River basin.

NRCS AWDB element WTEQ, duration DAILY, with the daily median (centralTendencyType=MEDIAN).
Stations, checked live 2026-11-20: 561 Kolob, 853 Webster Flat, 593 Long Valley Jct,
1066 Gardner Peak, 1065 Gutz Peak, all UT:SNTL.

Basin percent of median follows NRCS practice: sum of SWE divided by the sum of the same
stations' medians, and only where the median itself is at least half an inch. Early and late
in the season a percent of a trace is not a useful number; the panel shows inches instead.
"""
import datetime as dt

NAME = "snotel"
API = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1"
REFRESH_SEC = 6 * 3600
BEGIN = "2016-10-01"  # a decade is enough for April 1; the full station history is not on the first-load path
MIN_MEDIAN_IN = 0.5

# triplet, name, elev ft, lat, lon. Metadata is refreshed from AWDB when the call succeeds.
STATIONS = [
    ("561:UT:SNTL", "Kolob", 9250, 37.527, -113.054),
    ("853:UT:SNTL", "Webster Flat", 9150, 37.575, -112.902),
    ("593:UT:SNTL", "Long Valley Jct", 7460, 37.488, -112.515),
    ("1066:UT:SNTL", "Gardner Peak", 8320, 37.401, -113.460),
    ("1065:UT:SNTL", "Gutz Peak", 6790, 37.496, -113.942),
]


def init(con):
    con.execute(f"""
        create table if not exists {NAME}_stations (triplet varchar primary key, name varchar, elev_ft double, lat double, lon double);
        create table if not exists {NAME}_daily (triplet varchar, day date, swe_in double, primary key (triplet, day));
        create table if not exists {NAME}_median (triplet varchar, mmdd varchar, median_in double, primary key (triplet, mmdd));
        create table if not exists {NAME}_meta (k varchar primary key, v varchar);""")


def _meta(con, k):
    r = con.execute(f"select v from {NAME}_meta where k = ?", [k]).fetchone()
    return r[0] if r else None


def _meta_set(con, k, v):
    con.execute(f"insert or replace into {NAME}_meta values (?, ?)", [k, v])


def _store(con, payload):
    t, d, v, mt, mk, mv = [], [], [], [], [], []
    for st in payload or []:
        trip = st.get("stationTriplet")
        for el in st.get("data") or []:
            for x in el.get("values") or []:
                day = (x.get("date") or "")[:10]
                if len(day) < 10:
                    continue
                if x.get("value") is not None and x["value"] >= 0:
                    t.append(trip); d.append(day); v.append(float(x["value"]))
                if x.get("median") is not None and x["median"] >= 0:
                    mt.append(trip); mk.append(day[5:10]); mv.append(float(x["median"]))
    if t:
        con.execute(f"""insert or replace into {NAME}_daily
            select unnest(?::varchar[]), unnest(?::varchar[])::date, unnest(?::double[])""", [t, d, v])
    if mt:
        con.execute(f"""insert or replace into {NAME}_median
            select trip, mmdd, any_value(m) from (
                select unnest(?::varchar[]) trip, unnest(?::varchar[]) mmdd, unnest(?::double[]) m)
            group by all""", [mt, mk, mv])


def refresh(con, fetch):
    init(con)
    for trip, name, elev, lat, lon in STATIONS:
        con.execute(f"insert or ignore into {NAME}_stations values (?, ?, ?, ?, ?)", [trip, name, elev, lat, lon])
    last = _meta(con, "pulled_at")
    if last and (dt.datetime.now() - dt.datetime.fromisoformat(last)).total_seconds() < REFRESH_SEC:
        if con.execute(f"select count(*) from {NAME}_daily").fetchone()[0]:
            return
    try:
        meta = fetch(f"{API}/stations?stationTriplets={','.join(s[0] for s in STATIONS)}&activeOnly=false", timeout=90)
        for s in meta or []:
            if s.get("stationTriplet"):
                con.execute(f"""insert or replace into {NAME}_stations values (?, ?, ?, ?, ?)""",
                            [s["stationTriplet"], s.get("name") or s["stationTriplet"], s.get("elevation"),
                             s.get("latitude"), s.get("longitude")])
    except Exception as e:  # noqa: BLE001
        print(f"snotel station list failed: {e}", flush=True)
    today = dt.date.today()
    have = con.execute(f"select count(*) from {NAME}_daily").fetchone()[0]
    begin = BEGIN if not have else (today - dt.timedelta(days=400)).isoformat()
    trips = [s[0] for s in STATIONS]
    url = (f"{API}/data?stationTriplets={','.join(trips)}&elements=WTEQ&duration=DAILY"
           f"&beginDate={begin}&endDate={today.isoformat()}&centralTendencyType=MEDIAN")
    try:
        _store(con, fetch(url, timeout=240))
    except Exception as e:  # noqa: BLE001
        print(f"snotel batch failed ({e}); trying one station at a time", flush=True)
        for trip in trips:
            one = (f"{API}/data?stationTriplets={trip}&elements=WTEQ&duration=DAILY"
                   f"&beginDate={begin}&endDate={today.isoformat()}&centralTendencyType=MEDIAN")
            _store(con, fetch(one, timeout=180))
    _meta_set(con, "pulled_at", dt.datetime.now().isoformat(timespec="minutes"))


def _latest(con):
    """Latest SWE, with that calendar day's median, per station."""
    return con.execute(f"""
        with last as (select triplet, max("day") last_day from {NAME}_daily group by 1)
        select s.triplet, s.name, s.elev_ft, s.lat, s.lon, l.last_day, d.swe_in, m.median_in
        from {NAME}_stations s
        left join last l using (triplet)
        left join {NAME}_daily d on d.triplet = l.triplet and d."day" = l.last_day
        left join {NAME}_median m on m.triplet = l.triplet and m.mmdd = strftime(l.last_day, '%m-%d')
        order by s.elev_ft desc""").fetchall()


def _station_rows(rows):
    out = []
    for trip, name, elev, lat, lon, day, swe, med in rows:
        pct = round(100 * swe / med, 1) if swe is not None and med and med >= MIN_MEDIAN_IN else None
        out.append({"triplet": trip, "name": name, "elev_ft": elev, "lat": lon and lat, "lon": lon,
                    "swe_in": None if swe is None else round(swe, 2),
                    "median_in": None if med is None else round(med, 2),
                    "pct": pct, "as_of": day.isoformat() if day else None})
    # lat was set with a boolean trick above if lon is 0; fix properly
    for i, row in enumerate(rows):
        out[i]["lat"] = row[3]
        out[i]["lon"] = row[4]
    return out


def _basin(stations):
    use = [s for s in stations if s["swe_in"] is not None and s["median_in"] is not None and s["median_in"] >= MIN_MEDIAN_IN]
    swe = [s["swe_in"] for s in stations if s["swe_in"] is not None]
    as_of = max((s["as_of"] for s in stations if s["as_of"]), default=None)
    pct = round(100 * sum(s["swe_in"] for s in use) / sum(s["median_in"] for s in use), 1) if use else None
    return {"as_of": as_of, "pct_median": pct, "stations_in_pct": len(use),
            "swe_in": round(sum(swe) / len(swe), 2) if swe else None,
            "median_in": round(sum(s["median_in"] for s in use) / len(use), 2) if use else None,
            "min_median_in": MIN_MEDIAN_IN}


def query(con, window):
    init(con)
    stations = _station_rows(_latest(con))
    basin = _basin(stations)
    # Daily through the water year for short windows; monthly means when the window is long.
    wy_start = dt.date(window["to_day"].year if window["to_day"].month >= 10 else window["to_day"].year - 1, 10, 1)
    start = wy_start if window["days"] <= 400 else window["from_day"]
    if window["days"] > 400:
        raw = con.execute(f"""
            select d.triplet, strftime(date_trunc('month', d."day"), '%Y-%m-%d') ymd, round(avg(d.swe_in), 2) swe,
                   round(avg(m.median_in), 2) med
            from {NAME}_daily d left join {NAME}_median m on m.triplet = d.triplet and m.mmdd = strftime(d.day, '%m-%d')
            where d.day >= ? and d.day <= ? group by 1, 2 order by 1, 2""", [start, window["to_day"]]).fetchall()
    else:
        raw = con.execute(f"""
            select d.triplet, d.day, d.swe_in, m.median_in
            from {NAME}_daily d left join {NAME}_median m on m.triplet = d.triplet and m.mmdd = strftime(d.day, '%m-%d')
            where d.day >= ? and d.day <= ? order by 1, 2""", [start, window["to_day"]]).fetchall()
    series = [{"triplet": t, "day": str(day)[:10], "swe_in": swe, "median_in": med} for t, day, swe, med in raw]
    wy = window["to_day"].year + 1 if window["to_day"].month >= 10 else window["to_day"].year
    return {**basin, "water_year": wy, "stations": stations, "series": series, "grain": "monthly" if window["days"] > 400 else "daily"}


def history(con):
    init(con)
    april = con.execute(f"""
        select d.triplet, year(d.day + interval 3 month) wy, d.swe_in, m.median_in
        from {NAME}_daily d left join {NAME}_median m on m.triplet = d.triplet and m.mmdd = '04-01'
        where strftime(d.day, '%m-%d') = '04-01' order by 1, 2""").fetchall()
    peaks = con.execute(f"""
        select triplet, year("day" + interval 3 month) wy, max(swe_in) swe, arg_max("day", swe_in) peak_day
        from {NAME}_daily group by 1, 2 order by 1, 2""").fetchall()
    names = {r[0]: r[1] for r in con.execute(f"select triplet, name from {NAME}_stations").fetchall()}
    def pct(swe, med):
        return round(100 * swe / med, 1) if swe is not None and med and med >= MIN_MEDIAN_IN else None
    return {
        "stations": [{"triplet": t, "name": n} for t, n in names.items()],
        "april1": [{"triplet": t, "name": names.get(t, t), "water_year": wy,
                    "swe_in": None if swe is None else round(swe, 2), "median_in": None if med is None else round(med, 2),
                    "pct": pct(swe, med)} for t, wy, swe, med in april],
        "peaks": [{"triplet": t, "name": names.get(t, t), "water_year": wy,
                   "swe_in": round(swe, 2), "day": day.isoformat()} for t, wy, swe, day in peaks],
    }
