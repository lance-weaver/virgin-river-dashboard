// Page entry. util.js has helpers, state.js the shared data, charts.js the ECharts wrappers,
// map.js the map and radar, now.js the live readings, home.js the period's sections,
// history.js the Littlefield record, knobs.js which blocks show, panels.js the plug-ins.
import { charts } from './charts.js';
import { drawHistory } from './history.js';
import { render, windowText } from './home.js';
import { knobQuery, knobs, readKnobs, showKnobs } from './knobs.js';
import { resizeMap } from './map.js';
import { drawNow } from './now.js';
import { stackTables } from './panels.js';
import { addEventPresets, daysAgo, form, fromIn, preset, setPresetDates, syncPreset, toIn, today } from './period.js';
import { STATIC, api, state } from './state.js';
import { el } from './util.js';

export const status = document.getElementById('status');
const FONTS = Promise.race([
  Promise.all(['12px "IBM Plex Mono"', '500 12px "IBM Plex Mono"', '13px "IBM Plex Sans"'].map(f => document.fonts.load(f))),
  new Promise(r => setTimeout(r, 3000)),
]).catch(() => {});

export async function load() {
  history.replaceState(null, '', knobQuery(fromIn.value, toIn.value));
  status.textContent = 'Loading data.';
  document.getElementById('answer-h').textContent = 'Loading the latest gauge readings…';
  const r = await api.data(fromIn.value, toIn.value);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  await FONTS;
  state.DATA = j;
  addEventPresets(j.events);
  render();
  drawNow();
  status.textContent = `Showing ${windowText(j.window).when}.`;
}
export function showError(e) {
  drawNow();
  document.getElementById('answer-h').replaceChildren(el('span', { className: 'err', textContent: `Couldn't load the gauge data: ${e.message}` }));
  document.getElementById('answer-p').textContent = STATIC
    ? 'Pick one of the periods in the list. The published page only has those periods.'
    : 'Check the dates, or check that the server is running, and press Refresh data.';
  status.textContent = 'Loading failed.';
}

setPresetDates();
const qs = new URLSearchParams(location.search);
readKnobs(qs);
fromIn.value = qs.get('from') || daysAgo(6);
toIn.value = qs.get('to') || today();
fromIn.max = toIn.max = today();
syncPreset();
showKnobs();
load().catch(showError);

const loadHistory = () => state.HIST ? Promise.resolve() : api.history().then(r => r.json()).then(j => { state.HIST = j; });
if (knobs.hist) loadHistory().then(drawHistory);

export function setKnobs(change) {
  Object.assign(knobs, change);
  if (knobs.topic === 'glance' && knobs.hist) { if (change.topic) knobs.hist = false; else knobs.topic = 'river'; }
  showKnobs();
  syncPreset();
  history.replaceState(null, '', knobQuery(fromIn.value, toIn.value));
  render();
  if (knobs.hist) loadHistory().then(drawHistory);
  requestAnimationFrame(() => {
    stackTables();
    Object.values(charts).forEach(c => c.resize());
    if (knobs.view === 'map' || knobs.topic === 'glance') resizeMap();
  });
}
for (const id of ['topic', 'view']) document.getElementById(id).addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.value !== knobs[id]) setKnobs({ [id]: b.value });
});
document.getElementById('sources-btn').addEventListener('click', () => {
  const about = document.getElementById('about'), f = about.querySelector('footer.sources');
  about.open = true;
  f.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const h = f.querySelector('h2');
  h.setAttribute('tabindex', '-1');
  h.focus({ preventScroll: true });
});
document.fonts?.ready.then(() => { if (state.DATA) render(); if (knobs.hist && state.HIST) drawHistory(); });

export const btn = document.getElementById('refresh');
if (STATIC) {
  btn.hidden = true;
  document.getElementById('hist-apply').hidden = true;
  const custom = preset.querySelector('option[value="custom"]');
  if (custom) custom.remove();
  form.querySelectorAll('input[type="date"], button[type="submit"]').forEach(x => {
    x.closest('label')?.setAttribute('hidden', '');
    if (x.type === 'submit') x.hidden = true;
  });
}
btn.addEventListener('click', async () => {
  btn.disabled = true; btn.textContent = 'Refreshing…'; status.textContent = 'Refreshing data.';
  try {
    const r = await fetch('/api/refresh', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    setPresetDates();
    state.HIST = null;
    await load();
    status.textContent = 'Data updated.';
  } catch (e) { showError(e); }
  finally { btn.disabled = false; btn.textContent = 'Refresh data'; }
});
let resizeTimer;
new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => Object.values(charts).forEach(c => c.resize()), 120); }).observe(document.querySelector('.wrap'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.DATA) render(); if (state.HIST) drawHistory(); });
if (!STATIC) setInterval(() => load().catch(() => {}), 15 * 60 * 1000);
else document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    const m = await fetch(`data/manifest.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json());
    if (m.built_at && m.built_at !== STATIC.built_at) location.reload();
  } catch { /* stay on this build */ }
});
