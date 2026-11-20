import { barChart, base, chart, charts, emptyChart, lineChart } from './charts.js';
import { refreshCards } from './home.js';
import { showKnobs } from './knobs.js';
import { STATIC, api, state } from './state.js';
import { addDays, b, cite, css, el, fmt1, fmtDay, fmtInt, isoDay, link, parseDay, parseHour, pretty } from './util.js';

// A panel file calls VRD.register({ id, topic, view, order, mount, render, renderHistory, card }).
export const PANELS = [];
const panelRoot = (p) => {
  if (p.__root) return p.__root;
  p.__root = p.mount(document.getElementById('stage-sections'));
  if (!p.__root) return p.__root;
  if (p.__root.classList.contains('fact')) document.getElementById('stage-facts').append(p.__root);
  Object.assign(p.__root.dataset, { topic: p.topic, view: p.view });
  showKnobs();
  return p.__root;
};
function renderPanel(p, history) {
  try {
    if (history && p.renderHistory && state.HIST) p.renderHistory(state.HIST.sources?.[p.id], state.HIST, panelRoot(p));
    else if (!history && p.render && state.DATA) p.render(state.DATA.sources?.[p.id], state.DATA, panelRoot(p));
  } catch (e) { console.error(`panel ${p.id}`, e); }
}
export function renderPanels(history = false) { for (const p of PANELS) renderPanel(p, history); }

const ROWS_SHOWN = 12, ROWS_MIN = 16, expanded = new Set();
function shortenTables() {
  for (const table of document.querySelectorAll('#stage table')) {
    if (table.closest('.sr-only')) continue;
    const rows = [...table.querySelectorAll(':scope > tbody > tr')], tb = table.tBodies[0];
    if (!tb || (table.__first === rows[0] && table.__n === rows.length)) continue;
    table.__first = rows[0]; table.__n = rows.length;
    table.__more?.remove(); table.__more = null;
    if (rows.length < ROWS_MIN) continue;
    const key = table.closest('section, .fact')?.querySelector('h2')?.textContent || '';
    const btn = el('button', { type: 'button', className: 'more-rows' });
    const set = (open) => {
      rows.forEach((r, i) => { r.hidden = !open && i >= ROWS_SHOWN; });
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Show fewer rows' : `Show all ${rows.length} rows`;
      open ? expanded.add(key) : expanded.delete(key);
    };
    btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
    set(expanded.has(key));
    (table.closest('.tablewrap') || table).after(btn);
    table.__more = btn;
  }
}
const PHONE = matchMedia('(max-width: 599px)');
export function stackTables() {
  for (const table of document.querySelectorAll('main table')) {
    if (table.closest('.sr-only') || !table.tHead) continue;
    const head = [...table.tHead.rows].at(-1), labels = [];
    for (const c of head?.cells || []) for (let k = 0; k < (c.colSpan || 1); k++) labels.push(c.textContent.trim());
    const tooWide = PHONE.matches && table.offsetWidth > (table.parentElement?.clientWidth ?? innerWidth) + 2;
    if (labels.length < 5 && !tooWide) continue;
    if (!table.classList.contains('stack')) {
      table.classList.add('stack');
      table.setAttribute('role', 'table');
      for (const c of head.cells) c.setAttribute('role', 'columnheader');
      for (const r of table.tHead.rows) r.setAttribute('role', 'row');
    }
    for (const body of [...table.tBodies, table.tFoot].filter(Boolean)) {
      body.setAttribute('role', 'rowgroup');
      for (const r of body.rows) {
        if (r.__stacked) continue;
        r.__stacked = true;
        r.setAttribute('role', 'row');
        let i = 0;
        for (const c of r.cells) {
          if (c.dataset.label == null) c.dataset.label = labels[i] ?? '';
          c.setAttribute('role', c.tagName === 'TH' ? 'rowheader' : 'cell');
          i += c.colSpan || 1;
        }
      }
    }
  }
}
let queued = false;
new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; shortenTables(); stackTables(); }); } })
  .observe(document.querySelector('main'), { childList: true, subtree: true });

window.VRD = {
  register(p) {
    PANELS.push(p);
    PANELS.sort((a, c) => (a.order ?? 50) - (c.order ?? 50));
    if (state.DATA) { renderPanel(p); if (p.card) refreshCards(); }
    if (state.HIST) renderPanel(p, true);
  },
  css, fmtInt, fmt1, pretty, parseDay, parseHour, isoDay, addDays, fmtDay, el, b, link, cite,
  chart, emptyChart, base, lineChart, barChart, charts,
};
api.panels().then(r => r.json()).then(files => {
  for (const f of files) document.body.append(el('script', { src: `panels/${f}${STATIC ? `?v=${encodeURIComponent(STATIC.built_at)}` : ''}` }));
}).catch(() => {});
