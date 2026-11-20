import { state } from './state.js';
import { css, el, fmt1, fmtDay, fmtInt, link, pad, parseDay } from './util.js';

// Basin the page opens on: upper Virgin, Fort Pearce Wash, lower Virgin.
const BASIN = [[-114.1, 36.85], [-112.5, 37.65]];
let MAP = null, POPUP = null;

export function drawMap(img) {
  const D = state.DATA;
  if (!D) return;
  const holder = document.getElementById('map');
  const imgNote = document.getElementById('imagery-note');
  if (img) imgNote.replaceChildren('Satellite picture: ', link('Copernicus Sentinel-2', 'https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a'), `, clearest passes from ${fmtDay(parseDay(img.oldest))} to ${fmtDay(parseDay(img.newest))}, shown when zoomed in. Zoomed out is EOX's 2024 cloud-free mosaic.`);
  else imgNote.textContent = 'Satellite picture unavailable right now. The gauge dots still draw.';
  const bySite = Object.fromEntries((D.by_site || []).map(s => [s.site_id, s]));
  const features = (D.sites || []).map(g => {
    const s = bySite[g.site_id];
    const live = s && s.readings > 0;
    const value = live ? `${fmtInt(s.latest_cfs)} cfs` : 'no reading this period';
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, properties: {
      name: g.short || g.name, value, label: `${g.short || g.name} · ${value}`,
      kind: live ? g.role : 'off', rank: g.role === 'mainstem' ? g.sort : 20 + (g.sort || 0),
      detail: `USGS ${g.site_id}<br>${g.name}${live ? `<br>${fmtInt(s.mean_cfs)} cfs average, ${fmtInt(s.window_af)} acre-ft` : ''}` } };
  });
  for (const r of D.sources?.reservoirs?.reservoirs || []) {
    if (r.lat == null) continue;
    const value = r.pct == null ? 'no storage report' : `${r.pct}% full`;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: {
      name: r.name, value, label: `${r.name} · ${value}`, kind: 'reservoir', rank: 30,
      detail: `${r.storage_af == null ? 'No month-end storage' : `${fmtInt(r.storage_af)} of ${fmtInt(r.capacity_af)} acre-ft`}<br>End of month, NRCS` } });
  }
  for (const s of D.sources?.snotel?.stations || []) {
    if (s.lat == null) continue;
    const value = s.swe_in == null ? 'no snow report' : `${fmt1(s.swe_in)} in SWE`;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: {
      name: s.name, value, label: `${s.name} · ${value}`, kind: 'snow', rank: 40,
      detail: `SNOTEL ${s.triplet}<br>${s.median_in == null ? '' : `Median ${fmt1(s.median_in)} in`}` } });
  }
  const list = document.getElementById('map-list');
  list.replaceChildren(...features.map(f => el('li', { textContent: `${f.properties.name}: ${f.properties.value}` })));
  if (!window.maplibregl) { holder.hidden = true; return; }
  const data = { type: 'FeatureCollection', features };
  if (!MAP) {
    MAP = new maplibregl.Map({
      container: holder, bounds: BASIN, fitBoundsOptions: { padding: 28 }, maxZoom: 14, minZoom: 6,
      dragRotate: false, pitchWithRotate: false, cooperativeGestures: true,
      attributionControl: { compact: matchMedia('(max-width: 599px)').matches },
      style: { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': css('--grid') } }] },
    });
    MAP.touchZoomRotate.disableRotation();
    MAP.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    MAP.once('idle', () => holder.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));
    MAP.getCanvas().setAttribute('aria-label', 'Map of the Virgin River basin, its gauges, reservoirs, and snow stations. The same places are listed after the map.');
  }
  const apply = () => {
    if (!MAP.getSource('s2-year')) {
      MAP.addSource('s2-year', { type: 'raster', tileSize: 256, maxzoom: 14,
        tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
        attribution: 'Zoomed-out picture: <a href="https://s2maps.eu">Sentinel-2 cloudless 2024 by EOX</a> (Contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0' });
      MAP.addLayer({ id: 's2-year', type: 'raster', source: 's2-year' });
    }
    if (img && MAP.__tiles !== img.tiles) {
      ['s2'].forEach(id => { if (MAP.getLayer(id)) MAP.removeLayer(id); if (MAP.getSource(id)) MAP.removeSource(id); });
      MAP.addSource('s2', { type: 'raster', tiles: [img.tiles], tileSize: 256, minzoom: 8, maxzoom: 14,
        attribution: `Contains modified Copernicus Sentinel data ${img.newest.slice(0, 4)}, via Microsoft Planetary Computer` });
      MAP.addLayer({ id: 's2', type: 'raster', source: 's2' });
      MAP.__tiles = img.tiles;
    }
    if (!MAP.getSource('places')) {
      MAP.addSource('places', { type: 'raster', tileSize: 256,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Place names: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community' });
      MAP.addLayer({ id: 'places', type: 'raster', source: 'places', paint: { 'raster-opacity': 0.85 } });
    }
    if (MAP.getSource('pts')) { MAP.getSource('pts').setData(data); return; }
    MAP.addSource('pts', { type: 'geojson', data });
    const ink = css('--ink'), paper = css('--paper'), hydro = css('--hydro'), pen = css('--pen'), healthy = css('--healthy');
    MAP.addLayer({ id: 'places-pt', type: 'circle', source: 'pts', paint: {
      'circle-radius': ['match', ['get', 'kind'], 'reservoir', 7, 'snow', 6, 'mainstem', 6.5, 5],
      'circle-color': ['match', ['get', 'kind'], 'mainstem', ink, 'tributary', hydro, 'reservoir', pen, 'snow', healthy, paper],
      'circle-stroke-color': ['match', ['get', 'kind'], 'off', ink, paper],
      'circle-stroke-width': 2 } });
    MAP.addLayer({ id: 'pt-labels', type: 'symbol', source: 'pts', layout: {
      'text-field': ['step', ['zoom'], ['case', ['<', ['get', 'rank'], 12], ['get', 'label'], ''], 9, ['get', 'label']],
      'text-font': ['Noto Sans Regular'], 'text-size': 12, 'symbol-sort-key': ['get', 'rank'],
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9,
      'text-justify': 'auto', 'text-max-width': 12, 'text-optional': true, 'text-padding': 2 },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#0c100f', 'text-halo-width': 1.6 } });
    if (!MAP.__clicks) {
      MAP.__clicks = true;
      MAP.on('click', 'places-pt', (e) => {
        const p = e.features[0].properties;
        POPUP?.remove();
        POPUP = new maplibregl.Popup({ closeButton: true, offset: 10 }).setLngLat(e.features[0].geometry.coordinates)
          .setHTML(`<b>${p.name}</b><br>${p.value}<br>${p.detail}`).addTo(MAP);
      });
      MAP.on('mouseenter', 'places-pt', () => { MAP.getCanvas().style.cursor = 'pointer'; });
      MAP.on('mouseleave', 'places-pt', () => { MAP.getCanvas().style.cursor = ''; });
    }
  };
  MAP.loaded() ? apply() : MAP.once('load', apply);
  drawRadar();
}

const RADAR_TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';
const RADAR_PAST = (t) => `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${t}/{z}/{x}/{y}.png`;
const RADAR_META = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json';
const RADAR_OPACITY = 0.55;
const SPANS = { 3: { steps: 18, min: 10 }, 12: { steps: 24, min: 30 }, 24: { steps: 48, min: 30 } };
let LOOP_STEPS = 18, LOOP_MIN = 10;
const utcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const frameClock = (d) => d.toDateString() === new Date().toDateString() ? clock(d) : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${clock(d)}`;
const loopBtn = document.getElementById('radar-play'), loopSlider = document.getElementById('radar-slider'), loopSpan = document.getElementById('radar-span');
let radarTimer = null, radarValid = '', loopBuiltFor = '', loopTimer = null;
const frameTime = (i) => new Date(new Date(radarValid).getTime() - (LOOP_STEPS - i) * LOOP_MIN * 60000);
const frameLayers = () => MAP ? MAP.getStyle().layers.filter(l => l.id.startsWith('radar')).map(l => l.id) : [];
function showFrame(i) {
  loopSlider.value = i;
  const t = frameTime(i), latest = i === LOOP_STEPS;
  loopSlider.setAttribute('aria-valuetext', `${frameClock(t)}${latest ? ', latest' : ''}`);
  document.getElementById('radar-time').textContent = radarValid ? `(${frameClock(t)}${latest ? '' : ', replay'})` : '';
  for (const id of frameLayers()) MAP.setPaintProperty(id, 'raster-opacity', id === (latest ? 'radar' : `radar-${i}`) ? RADAR_OPACITY : 0);
}
function buildLoop() {
  const key = `${radarValid}|${loopSpan.value}`;
  if (loopBuiltFor === key || !MAP?.getLayer('radar')) return;
  for (const id of frameLayers()) if (id !== 'radar') { MAP.removeLayer(id); MAP.removeSource(id); }
  for (let i = 0; i < LOOP_STEPS; i++) {
    MAP.addSource(`radar-${i}`, { type: 'raster', tiles: [RADAR_PAST(utcStamp(frameTime(i)))], tileSize: 256, maxzoom: 11 });
    MAP.addLayer({ id: `radar-${i}`, type: 'raster', source: `radar-${i}`, paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0 } }, 'radar');
  }
  loopBuiltFor = key;
}
function stopLoop() { clearInterval(loopTimer); loopTimer = null; loopBtn.setAttribute('aria-pressed', 'false'); loopBtn.textContent = 'Play'; }
function playLoop() {
  buildLoop();
  if (+loopSlider.value >= LOOP_STEPS) showFrame(0);
  loopBtn.setAttribute('aria-pressed', 'true'); loopBtn.textContent = 'Pause';
  let hold = 0;
  loopTimer = setInterval(() => {
    const i = +loopSlider.value;
    if (i < LOOP_STEPS) return showFrame(i + 1);
    if (++hold > 3) { hold = 0; showFrame(0); }
  }, Math.max(200, 9000 / LOOP_STEPS));
}
loopBtn.addEventListener('click', () => loopTimer ? stopLoop() : playLoop());
loopSlider.addEventListener('input', () => { stopLoop(); buildLoop(); showFrame(+loopSlider.value); });
loopSpan.addEventListener('change', () => {
  const playing = !!loopTimer, sp = SPANS[loopSpan.value];
  stopLoop();
  LOOP_STEPS = sp.steps; LOOP_MIN = sp.min;
  loopSlider.max = LOOP_STEPS;
  loopSlider.setAttribute('aria-label', `Radar time, last ${loopSpan.value} hours in ${LOOP_MIN}-minute steps`);
  if (MAP?.getLayer('radar')) showFrame(LOOP_STEPS);
  if (playing) playLoop();
});
async function drawRadar() {
  const on = document.getElementById('show-radar').checked;
  clearTimeout(radarTimer);
  document.getElementById('radar-loop').hidden = !on;
  if (!MAP) return;
  if (!on) { stopLoop(); for (const id of frameLayers()) MAP.setLayoutProperty(id, 'visibility', 'none'); document.getElementById('radar-time').textContent = ''; return; }
  const was = radarValid;
  try { radarValid = (await fetch(RADAR_META, { cache: 'no-store' }).then(r => r.json())).meta.valid; } catch { /* keep the last frame */ }
  const go = () => {
    const tiles = [`${RADAR_TILES}?v=${encodeURIComponent(radarValid)}`];
    if (!MAP.getSource('radar')) {
      MAP.addSource('radar', { type: 'raster', tiles, tileSize: 256, maxzoom: 11,
        attribution: 'Radar: NWS NEXRAD via <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>' });
      const before = ['places-pt', 'pt-labels'].find(id => MAP.getLayer(id));
      MAP.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': RADAR_OPACITY, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0 } }, before);
    } else if (radarValid !== was) MAP.getSource('radar').setTiles(tiles);
    for (const id of frameLayers()) MAP.setLayoutProperty(id, 'visibility', 'visible');
    if (radarValid !== was && loopBuiltFor) { const playing = !!loopTimer; stopLoop(); buildLoop(); if (playing) playLoop(); }
    if (!loopTimer) showFrame(+loopSlider.value);
  };
  MAP.isStyleLoaded() ? go() : MAP.once('idle', go);
  radarTimer = setTimeout(drawRadar, 5 * 60 * 1000);
}
document.getElementById('show-radar').addEventListener('change', drawRadar);
export const resizeMap = () => MAP?.resize();
