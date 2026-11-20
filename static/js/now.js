// Live readings, fetched by the browser from USGS and the St. George airport so they don't wait on the hourly rebuild.
import { state } from './state.js';
import { USGS, el, fmt1, fmtInt, link } from './util.js';

const GAUGES = [
  ['09408150', 'Hurricane'],
  ['09408135', 'Above Quail Creek'],
  ['09406000', 'Virgin'],
  ['09413000', 'Santa Clara'],
  ['09415000', 'Littlefield'],
];
const IV = `https://waterservices.usgs.gov/nwis/iv/?${new URLSearchParams({ format: 'json', sites: GAUGES.map(g => g[0]).join(','), parameterCd: '00060', period: 'PT6H', siteStatus: 'all' })}`;
const OBS = 'https://api.weather.gov/stations/KSGU/observations/latest';
const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
let timer = null;

async function gauges() {
  const j = await fetch(IV).then(r => r.ok ? r.json() : Promise.reject(new Error(`USGS ${r.status}`)));
  const out = {};
  for (const t of j.value.timeSeries) {
    const nd = t.variable.noDataValue;
    const vals = t.values[0].value.filter(v => +v.value !== nd && +v.value > -998).map(v => ({ v: +v.value, t: new Date(v.dateTime) }));
    if (!vals.length) continue;
    const last = vals.at(-1), back = vals.find(v => last.t - v.t <= 3 * 3600e3) || vals[0];
    out[t.sourceInfo.siteCode[0].value] = { last, back };
  }
  return out;
}
function trend(now, before) {
  if (before == null) return '';
  const r = now / before;
  return r > 1.1 ? `rising, from ${fmtInt(before)} cfs` : r < 0.9 ? `falling, from ${fmtInt(before)} cfs` : 'steady over the last few hours';
}
const item = (label, val, sub) => el('li', {}, el('span', { className: 'lbl', textContent: label }), el('span', { className: 'val', textContent: val }), el('span', { className: 'sub', textContent: sub }));

export async function drawNow() {
  clearTimeout(timer);
  timer = setTimeout(drawNow, 5 * 60 * 1000);
  const list = document.getElementById('now-list'), when = document.getElementById('now-time');
  const [g, w] = await Promise.allSettled([
    gauges(),
    fetch(OBS, { headers: { Accept: 'application/geo+json' } }).then(r => r.ok ? r.json() : Promise.reject(new Error(`NWS ${r.status}`))),
  ]);
  const items = [], times = [];
  if (w.status === 'fulfilled') {
    const p = w.value.properties, mm = p.precipitationLastHour?.value, c = p.temperature?.value;
    times.push(new Date(p.timestamp));
    const rain = mm == null ? 'no rain report for the last hour' : mm > 0 ? `${(mm / 25.4).toFixed(2)} in of rain last hour` : 'no rain last hour';
    items.push(item('St. George airport', p.textDescription || '—', `${rain}${c == null ? '' : ` · ${Math.round(c * 9 / 5 + 32)}°F`}`));
  } else items.push(item('St. George airport', '—', 'Weather Service reading unavailable.'));
  if (g.status === 'fulfilled') {
    const base = state.DATA?.window?.is_default ? Object.fromEntries((state.DATA.by_site || []).map(s => [s.site_id, s.baseline_cfs])) : {};
    for (const [id, label] of GAUGES) {
      const row = g.value[id];
      if (!row) { items.push(item(label, '—', 'no reading')); continue; }
      times.push(row.last.t);
      const vs = base[id] ? (row.last.v / base[id] >= 0.85 && row.last.v / base[id] < 1.15 ? 'near the prior two weeks' : `${Math.round(row.last.v / base[id] * 100)}% of the prior two weeks`) : '';
      items.push(item(label, `${fmtInt(row.last.v)} cfs`, [trend(row.last.v, row.back.v), vs].filter(Boolean).join(' · ')));
    }
  } else items.push(item('River gauges', '—', 'USGS readings unavailable.'));
  list.replaceChildren(...items);
  const newest = times.sort((a, c) => c - a)[0];
  when.textContent = newest ? `· ${clock(newest)}` : '';
  document.getElementById('src-now').replaceChildren(
    'Source: USGS instantaneous discharge, gauges ',
    ...GAUGES.flatMap(([id], i) => [i ? ', ' : '', link(id, USGS(id))]),
    ' (provisional), and the St. George airport observation (KSGU) from the ',
    link('National Weather Service API', 'https://www.weather.gov/documentation/services-web-api'),
    '. Your browser fetches these about every 5 minutes. "Prior two weeks" is the median flow for the 14 days before the period shown, and only on the default period.');
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') drawNow(); });
