"""Lake Powell and Lake Mead, the Colorado River context for the Virgin.

The Virgin joins the Colorado in the Overton Arm of Lake Mead. Lake Powell is upstream of that
confluence, on the Colorado main stem, and the two reservoirs together are the storage the basin
is operated on. They are context, not Virgin River reservoirs.

Primary files, daily, from USBR Upper Colorado hydrodata (checked live 2026-11-20; both lakes
had a value for 2026-11-19):

    Powell  https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/csv/49.csv   pool elevation, ft
            https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/csv/17.csv   storage, acre-feet
    Mead    https://www.usbr.gov/uc/water/hydrodata/reservoir_data/921/csv/49.csv   pool elevation, ft
            https://www.usbr.gov/uc/water/hydrodata/reservoir_data/921/csv/17.csv   storage, acre-feet

The Powell storage series matches USBR's published live storage (on 2024-10-27 both say 9.06 million
acre-feet at elevation 3,577.04 ft). Percent full uses the live capacity USBR states for Powell,
23.314 million acre-feet at 3,700 ft. Mead's percent uses 26.12 million acre-feet, the published
active capacity near elevation 1,220 ft. Both denominators are named on the page.

If a hydrodata file fails, the same series is taken from USBR RISE:
    Powell elevation item 508, storage item 509 (catalog record 2362, location 393)
    Mead elevation item 6123, storage item 6124 (catalog record 4370, location 3514)
"""
import csv
import datetime as dt

from sources._http import fetch_text

NAME = "colorado"
REFRESH_SEC = 12 * 3600
RISE = "https://data.usbr.gov/rise/api/result/download?type=csv&itemId={item}"

# Live / active capacity used only for the percent. The stored acre-feet are the agency's, unscaled.
LAKES = {
    "powell": {"name": "Lake Powell", "full_ft": 3700.0, "capacity_af": 23314000,
               "capacity_note": "23.314 million acre-feet, total live storage at elevation 3,700 ft (USBR CRSP monthly summary).",
               "hydro_elev": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/csv/49.csv",
               "hydro_stor": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/csv/17.csv",
               "rise_elev": 508, "rise_stor": 509,
               "refs": [{"ft": 3700, "label": "Full pool, 3,700 ft"},
                        {"ft": 3525, "label": "3,525 ft, the 2022–24 drought-response target"},
                        {"ft": 3490, "label": "Minimum power pool, 3,490 ft"}]},
    "mead": {"name": "Lake Mead", "full_ft": 1219.6, "capacity_af": 26120000,
             "capacity_note": "26.12 million acre-feet, a published active capacity near elevation 1,220 ft.",
             "hydro_elev": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/921/csv/49.csv",
             "hydro_stor": "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/921/csv/17.csv",
             "rise_elev": 6123, "rise_stor": 6124,
             "refs": [{"ft": 1219.6, "label": "Full pool, about 1,219.6 ft"},
                      {"ft": 1075, "label": "1,075 ft, Tier 1 shortage (2007 Interim Guidelines)"},
                      {"ft": 1050, "label": "1,050 ft, Tier 2"},
                      {"ft": 1025, "label": "1,025 ft, Tier 3"}]},
}


def init(con):
    con.execute(f"""
        create table if not exists {NAME}_elev (lake varchar, day date, elev_ft double, primary key (lake, day));
        create table if not exists {NAME}_stor (lake varchar, day date, storage_af double, primary key (lake, day));
        create table if not exists {NAME}_meta (k varchar primary key, v varchar);""")


def _meta(con, k):
    r = con.execute(f"select v from {NAME}_meta where k = ?", [k]).fetchone()
    return r[0] if r else None


def _meta_set(con, k, v):
    con.execute(f"insert or replace into {NAME}_meta values (?, ?)", [k, v])


def parse_series(text):
    """Hydrodata two-column CSV, or a RISE download with a preamble, to [(day, value)]."""
    mode = None
    hydro, rise = [], []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or s.startswith('"#'):
            continue
        low = s.lower().replace('"', "")
        if low.startswith("datetime,") or low.startswith("datetime\t"):
            mode = "hydro"
            continue
        if "datetime" in low and "result" in low:
            mode = "rise"
            continue
        if mode == "hydro":
            parts = s.split(",")
            if len(parts) < 2 or not parts[1].strip():
                continue
            try:
                hydro.append((parts[0][:10], float(parts[1])))
            except ValueError:
                continue
        elif mode == "rise":
            rise.append(s)
    if mode == "rise":
        for rec in csv.reader(rise):
            if len(rec) < 7:
                continue
            try:
                val = float(rec[2])
            except ValueError:
                continue
            day = rec[6][:10]
            if len(day) == 10:
                hydro.append((day, val))
    return hydro


def _put(con, table, lake, pairs, col):
    for i in range(0, len(pairs), 8000):
        chunk = pairs[i:i + 8000]
        con.execute(f"""insert or replace into {table}
                        select ?, unnest(?::varchar[])::date, unnest(?::double[])""",
                    [lake, [p[0] for p in chunk], [p[1] for p in chunk]])


def _pull_one(kind_url, rise_item):
    try:
        text = fetch_text(kind_url, timeout=180)
        rows = parse_series(text)
        if len(rows) > 100:
            return rows, "usbr-hydrodata"
    except Exception as e:  # noqa: BLE001
        print(f"hydrodata failed ({e}); trying RISE item {rise_item}", flush=True)
    text = fetch_text(RISE.format(item=rise_item), timeout=300)
    rows = parse_series(text)
    if len(rows) < 100:
        raise RuntimeError(f"RISE item {rise_item} returned {len(rows)} values")
    return rows, "rise"


def refresh(con, fetch):
    init(con)
    last = _meta(con, "pulled_at")
    filled = con.execute(f"select count(*) from {NAME}_stor").fetchone()[0] > 1000
    if last and filled and (dt.datetime.now() - dt.datetime.fromisoformat(last)).total_seconds() < REFRESH_SEC:
        return
    sources = set()
    for lake, spec in LAKES.items():
        elev, src_e = _pull_one(spec["hydro_elev"], spec["rise_elev"])
        stor, src_s = _pull_one(spec["hydro_stor"], spec["rise_stor"])
        _put(con, f"{NAME}_elev", lake, elev, "elev_ft")
        _put(con, f"{NAME}_stor", lake, stor, "storage_af")
        sources.add(src_e); sources.add(src_s)
        print(f"{lake}: {len(elev)} elevations ({src_e}), {len(stor)} storage values ({src_s})", flush=True)
    _meta_set(con, "source", "rise" if sources == {"rise"} else "usbr-hydrodata")
    _meta_set(con, "pulled_at", dt.datetime.now().isoformat(timespec="minutes"))


def _latest(con):
    out = []
    for lake, spec in LAKES.items():
        elev = con.execute(f"select day, elev_ft from {NAME}_elev where lake = ? order by day desc limit 1", [lake]).fetchone()
        stor = con.execute(f"select day, storage_af from {NAME}_stor where lake = ? order by day desc limit 1", [lake]).fetchone()
        day = max([d for d in (elev[0] if elev else None, stor[0] if stor else None) if d], default=None)
        storage = stor[1] if stor else None
        cap = spec["capacity_af"]
        out.append({"id": lake, "name": spec["name"], "day": day.isoformat() if day else None,
                    "elev_ft": None if not elev else round(elev[1], 2),
                    "storage_af": None if storage is None else round(storage),
                    "pct": None if not storage else round(100 * storage / cap, 1),
                    "capacity_af": cap, "full_ft": spec["full_ft"], "capacity_note": spec["capacity_note"],
                    "refs": spec["refs"]})
    return out


def _series(con, lake, start, end, monthly):
    if monthly:
        return con.execute(f"""
            with e as (select date_trunc('month', day)::date m, avg(elev_ft) elev from {NAME}_elev
                       where lake = ? and day >= ? and day <= ? group by 1),
                 s as (select date_trunc('month', day)::date m, avg(storage_af) af from {NAME}_stor
                       where lake = ? and day >= ? and day <= ? group by 1)
            select coalesce(e.m, s.m), e.elev, s.af from e full outer join s using (m) order by 1""",
            [lake, start, end, lake, start, end]).fetchall()
    return con.execute(f"""
        select coalesce(e.day, s.day), e.elev_ft, s.storage_af
        from {NAME}_elev e full outer join {NAME}_stor s on e.lake = s.lake and e.day = s.day
        where coalesce(e.lake, s.lake) = ? and coalesce(e.day, s.day) >= ? and coalesce(e.day, s.day) <= ?
        order by 1""", [lake, start, end]).fetchall()


def query(con, window):
    init(con)
    monthly = window["days"] > 400
    start = window["from_day"] if window["days"] > 60 else window["to_day"] - dt.timedelta(days=365)
    series = []
    for lake in LAKES:
        for day, elev, af in _series(con, lake, start, window["to_day"], monthly):
            series.append({"lake": lake, "day": str(day)[:10],
                           "elev_ft": None if elev is None else round(elev, 2),
                           "storage_af": None if af is None else round(af)})
    return {"source": _meta(con, "source") or "usbr-hydrodata", "lakes": _latest(con), "series": series,
            "grain": "monthly" if monthly else "daily",
            "note": "The Virgin River flows into Lake Mead, through the Overton Arm. Lake Powell is upstream on the Colorado and is the other half of the storage the river system is operated on. Neither lake is in the Virgin basin."}


def history(con):
    init(con)
    # Month-end-ish monthly means for the whole record. Powell from 1963, Mead from the 1930s.
    series = []
    for lake in LAKES:
        first = con.execute(f"select min(day) from {NAME}_stor where lake = ?", [lake]).fetchone()[0] or dt.date(1935, 1, 1)
        for day, elev, af in _series(con, lake, first, dt.date.today(), monthly=True):
            series.append({"lake": lake, "day": str(day)[:10],
                           "elev_ft": None if elev is None else round(elev, 2),
                           "storage_af": None if af is None else round(af)})
    return {"source": _meta(con, "source"), "lakes": _latest(con), "series": series, "grain": "monthly"}
