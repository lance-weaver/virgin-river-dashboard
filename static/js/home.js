import { emptyChart, lineChart } from './charts.js';
import { knobs } from './knobs.js';
import { setKnobs } from './main.js';
import { drawMap } from './map.js';
import { PANELS, renderPanels } from './panels.js';
import { addEventPresets } from './period.js';
import { state } from './state.js';
import { ACIS, GAL_PER_AF, USGS, b, cite, css, el, fmt1, fmtDay, fmtInt, gaugeLinks, link, parseDay, parseHour, pretty, siteById, timesNormal } from './util.js';

const STEM_COLOR = {
  '09406000': '--hydro', '09406100': '--ink-2', '09408135': '--pen', '09408150': '--ink',
  '09413200': '--weber', '09413500': '--jordan', '09415000': '--healthy',
};
const TRIB_COLOR = ['--hydro', '--pen', '--weber', '--jordan', '--ink-2'];

let cardArgs = null;
export const refreshCards = () => { if (cardArgs) renderCards(cardArgs); };

function renderCards(D) {
  cardArgs = D;
  const cfg = D.config, hur = siteById(D, cfg.index_site), daily = D.window.resolution !== 'hourly';
  const set = (id, val, sub) => { document.getElementById(`c-${id}`).textContent = val; document.getElementById(`c-${id}-sub`).textContent = sub; };
  if (!hur || !hur.readings) set('flow', '—', 'No Hurricane reading in this period.');
  else if (daily) set('flow', `${fmtInt(hur.window_af)} ac-ft`, `passed Hurricane. Average ${fmtInt(hur.mean_cfs)} cfs.`);
  else set('flow', `${fmtInt(hur.latest_cfs)} cfs`, `at Hurricane. ${timesNormal(hur)}.`);
  const S = D.sources || {};
  for (const [id, pid] of [['res', 'reservoirs'], ['snow', 'snotel'], ['flood', 'flood']]) {
    const p = PANELS.find(x => x.id === pid && x.card);
    let c = null;
    try { c = p?.card(S[pid], D); } catch (e) { console.error(`card ${pid}`, e); }
    set(id, c?.val ?? '—', c?.sub ?? 'Not available right now.');
  }
}
document.querySelectorAll('.card[data-go]').forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  setKnobs({ topic: a.dataset.go, view: knobs.view === 'map' ? 'summary' : knobs.view, hist: false });
  const first = [...document.querySelectorAll('#stage [data-view]')].find(n => !n.hidden), h = first?.querySelector('h2');
  if (!first) return;
  first.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
}));

export function windowText(win) {
  const f = parseDay(win.from), t = parseDay(win.to);
  const yrs = f.getFullYear() !== t.getFullYear() || f.getFullYear() !== new Date().getFullYear();
  if (win.is_default) return { lead: `In the last ${win.days} days`, when: `Last ${win.days} days, through ${fmtDay(t)}` };
  if (win.days >= 360) return { lead: `From ${fmtDay(f, true)} to ${fmtDay(t, true)}`, when: `${fmtDay(f, true)} – ${fmtDay(t, true)}` };
  return win.from === win.to
    ? { lead: `On ${fmtDay(f, yrs)}`, when: fmtDay(f, yrs) }
    : { lead: `From ${fmtDay(f, yrs)} to ${fmtDay(t, yrs)}`, when: `${fmtDay(f, yrs)} – ${fmtDay(t, yrs)}` };
}

function seriesFor(D, id) {
  const rows = (D.flow_series || []).filter(r => r.site_id === id);
  const site = siteById(D, id);
  return { baseline: D.window.resolution === 'hourly' ? site?.baseline_cfs : null, points: rows.map(r => ({ t: parseHour(r.hour), v: r.cfs })) };
}

function flowList(D, sites, daily) {
  const ul = el('ul', { className: 'flowlist' });
  if (!sites.length) ul.append(el('li', { textContent: 'No readings for this period.' }));
  for (const s of sites) {
    const val = !s.readings ? 'no data' : daily ? `${fmtInt(s.window_af)} ac-ft` : `${fmtInt(s.latest_cfs)} cfs`;
    const sub = !s.readings ? s.name : daily ? `average ${fmtInt(s.mean_cfs)} cfs` : timesNormal(s);
    ul.append(el('li', {}, el('span', {}, s.short, el('small', { textContent: sub })), el('span', { className: 'x calm', textContent: val })));
  }
  return ul;
}

export function render() {
  const D = state.DATA;
  if (!D) return;
  addEventPresets(D.events);
  const cfg = D.config, win = D.window, wt = windowText(win), daily = win.resolution !== 'hourly';
  const hur = siteById(D, cfg.index_site), out = siteById(D, cfg.outlet_site), intake = siteById(D, cfg.intake_site);
  const mainstem = D.by_site.filter(s => s.role === 'mainstem');
  const tribs = D.by_site.filter(s => s.role === 'tributary');
  const rain = D.rain_basin?.[0]?.rain_in != null ? D.rain_basin[0] : null;
  document.getElementById('when').textContent = wt.when;
  const h = document.getElementById('answer-h'), p = document.getElementById('answer-p');
  const num = (t) => el('span', { className: 'num', textContent: t });
  if (hur?.readings && !daily) {
    h.replaceChildren(`${wt.lead}, the Virgin River near Hurricane is at `, num(`${fmtInt(hur.latest_cfs)} cfs`), '.');
    const gallons = (hur.window_af || 0) * GAL_PER_AF;
    p.replaceChildren(`About ${fmtInt(hur.window_af)} acre-feet passed the Hurricane gauge in this period`, gallons ? `, roughly ${pretty(gallons)} gallons. ` : '. ');
  } else if (hur?.readings) {
    h.replaceChildren(`${wt.lead}, `, num(`${fmtInt(hur.window_af)} acre-feet`), ' passed the Virgin River near Hurricane.');
    p.replaceChildren(`That is an average of ${fmtInt(hur.mean_cfs)} cfs. `);
  } else {
    h.textContent = `${wt.lead}, Hurricane has no discharge reading to lead with.`;
    p.replaceChildren();
  }
  if (intake?.readings) p.append(`Above the Quail Creek intake the river ${daily ? 'averaged' : 'is at'} ${fmtInt(daily ? intake.mean_cfs : intake.latest_cfs)} cfs. `);
  if (out?.readings) p.append(`At Littlefield, where the Virgin leaves the basin for Lake Mead, ${daily ? 'the average is' : 'it is'} ${fmtInt(daily ? out.mean_cfs : out.latest_cfs)} cfs. `);
  if (rain && rain.rain_in >= 0.05) p.append(`Valley rain gauges averaged ${rain.rain_in.toFixed(2)} inches.`);
  cite('src-answer', 'USGS discharge at ', link(cfg.index_site, USGS(cfg.index_site)), ' (Hurricane), ',
    link(cfg.intake_site, USGS(cfg.intake_site)), ' (above Quail Creek), and ', link(cfg.outlet_site, USGS(cfg.outlet_site)),
    ' (Littlefield). Recent values are provisional. One cfs for a day is about 1.98 acre-feet.');

  const at = D.refreshed_at;
  document.getElementById('asof').textContent = at ? `Updated ${at.slice(0, 10) === new Date().toISOString().slice(0, 10) ? at.slice(11, 16) : at}` : '';
  renderCards(D);

  document.getElementById('flow-lead').textContent = daily
    ? 'Acre-feet at each mainstem gauge for this period. These are one river sampled along its length, not separate volumes to add.'
    : 'Latest discharge compared with the median of the 14 days before this period. Gauges are upstream to downstream.';
  document.getElementById('flowlist').replaceChildren(...flowList(D, mainstem, daily).childNodes);
  cite('src-flow', 'USGS gauges ', ...gaugeLinks(mainstem.map(s => s.site_id)), '.');
  document.getElementById('trib-lead').textContent = 'Tributaries are not added into the mainstem totals above. Santa Clara joins the Virgin in St. George; Fort Pearce Wash joins below there.';
  document.getElementById('triblist').replaceChildren(...flowList(D, tribs, daily).childNodes);
  cite('src-trib', 'USGS gauges ', ...gaugeLinks(tribs.map(s => s.site_id)), '.');

  const hurSeries = [{ name: 'Hurricane', color: css('--pen'), ...seriesFor(D, cfg.index_site) }];
  if (hurSeries[0].points.length) lineChart('chart-glance-flow', hurSeries, { fmt: fmtInt, unit: ' cfs', zoom: true, zero: true,
    alt: `Discharge of the Virgin River near Hurricane. ${hur?.readings ? `Latest ${fmtInt(hur.latest_cfs)} cfs, peak ${fmtInt(hur.peak_cfs)} cfs.` : ''}` });
  else emptyChart('chart-glance-flow', 'No Hurricane readings for this period.');
  cite('src-glance-flow', 'USGS gauge ', link(`${cfg.index_site}, Virgin River near Hurricane`, USGS(cfg.index_site)),
    daily ? ', daily means.' : ', instantaneous values averaged by hour. The dashed line, when shown, is the median of the prior 14 days.');

  const stemLines = mainstem.map(s => ({ name: s.short, color: css(STEM_COLOR[s.site_id] || '--off'), ...seriesFor(D, s.site_id) }));
  if (stemLines.some(s => s.points.length)) lineChart('chart-rivers', stemLines, { fmt: fmtInt, unit: ' cfs', zoom: true,
    alt: `Mainstem discharge. ${mainstem.filter(s => s.readings).map(s => `${s.short} peaked at ${fmtInt(s.peak_cfs)} cfs`).join('; ')}.` });
  else emptyChart('chart-rivers', 'No mainstem readings for this period.');
  cite('src-rivers', 'USGS gauges ', ...gaugeLinks(mainstem.map(s => s.site_id)), '. Do not add these traces; each one already includes the water from upstream.');

  const tribLines = tribs.map((s, i) => ({ name: s.short, color: css(TRIB_COLOR[i % TRIB_COLOR.length]), ...seriesFor(D, s.site_id) }));
  if (tribLines.some(s => s.points.length)) lineChart('chart-tribs', tribLines, { fmt: fmtInt, unit: ' cfs', zoom: true,
    alt: `Tributary discharge. ${tribs.filter(s => s.readings).map(s => `${s.short} peaked at ${fmtInt(s.peak_cfs)} cfs`).join('; ')}.` });
  else emptyChart('chart-tribs', 'No tributary readings for this period.');
  cite('src-tribs', 'USGS gauges ', ...gaugeLinks(tribs.map(s => s.site_id)), '.');

  const excessPts = (D.flow_series || []).filter(r => r.site_id === cfg.index_site && r.in_window);
  if (daily || hur?.baseline_cfs == null) emptyChart('chart-cum', 'The comparison with the prior two weeks is shown for periods up to two months.');
  else {
    let run = 0;
    const points = excessPts.map(r => { run += ((r.cfs || 0) - hur.baseline_cfs) / 12.1; return { t: parseHour(r.hour), v: Math.round(run) }; });
    lineChart('chart-cum', [{ name: 'Hurricane', color: css('--pen'), points }], { fmt: fmtInt, unit: ' acre-ft',
      alt: `Running acre-feet at Hurricane relative to ${fmtInt(hur.baseline_cfs)} cfs, ending at ${fmtInt(points.at(-1)?.v)} acre-feet.` });
  }
  cite('src-cum', 'USGS gauge ', link(cfg.index_site, USGS(cfg.index_site)), '. Positive means the river ran above the median of the 14 days before the period.');

  document.getElementById('tbl-cap').textContent = `Readings for ${wt.when}. Normal, for periods up to two months, is the median of the ${cfg.baseline_days} days before ${fmtDay(parseDay(win.from), true)}. Acre-feet use 1.9835 acre-feet per cfs-day.`;
  const tb = document.querySelector('#site-table tbody');
  tb.replaceChildren();
  const cell = (v) => el('td', { textContent: v == null ? '—' : fmtInt(v) });
  for (const s of D.by_site) {
    tb.append(el('tr', {},
      el('th', { scope: 'row' }, link(s.site_id, USGS(s.site_id))),
      el('td', { textContent: s.short }),
      el('td', { textContent: s.role === 'mainstem' ? 'Mainstem' : 'Tributary' }),
      cell(daily ? null : s.baseline_cfs), cell(s.peak_cfs), cell(s.latest_cfs), cell(s.mean_cfs), cell(s.window_af),
      cell(daily ? null : s.excess_af)));
  }
  cite('src-table', link('USGS NWIS', 'https://waterdata.usgs.gov/'), daily ? ', daily means' : ', instantaneous values', '. Each site number opens the USGS page for that gauge.');

  // Rain chart is drawn by the sky panel; the basin median is cited with it.
  drawMap(D.imagery);
  cite('src-map', 'Gauge locations from the USGS site service, checked 2026-11-20, for HUC ', cfg.hucs.join(', '),
    '. Reservoir locations and snow stations are plotted from NRCS AWDB. Picture from Copernicus Sentinel-2. Lake Powell and Lake Mead are off this map; they are downstream and upstream context, drawn on their own panel.');
  renderPanels();
}
