import { base, chart } from './charts.js';
import { setKnobs } from './main.js';
import { renderPanels } from './panels.js';
import { form, fromIn, toIn } from './period.js';
import { STATIC, state } from './state.js';
import { USGS, cite, css, fmt1, fmtDay, fmtInt, isoDay, link, parseDay } from './util.js';

let histZoom = null;
export function drawHistory() {
  if (!state.HIST) return;
  const H = state.HIST, cfg = H.config || {};
  const pts = (H.littlefield_monthly || []).map(r => [parseDay(r.month), r.cfs]);
  const o = base();
  const lo = pts.length ? Math.min(...pts.map(p => p[1])) : 0, hi = pts.length ? Math.max(...pts.map(p => p[1])) : 0;
  o.aria.label = { enabled: true, description: `Monthly mean flow of the Virgin River at Littlefield from ${cfg.record_start || '1929'} to ${cfg.record_end || 'now'}, between ${fmtInt(lo)} and ${fmtInt(hi)} cubic feet per second.` };
  o.grid.bottom = 64;
  o.yAxis = { ...o.yAxis, axisLabel: { color: css('--ink-2'), formatter: (v) => fmtInt(v) } };
  o.tooltip.valueFormatter = (v) => `${fmtInt(v)} cfs`;
  o.dataZoom = [{ type: 'inside' }, { type: 'slider', height: 28, bottom: 8, borderColor: css('--rule'), textStyle: { color: css('--ink-2') },
    fillerColor: 'rgba(127,127,127,.18)', dataBackground: { lineStyle: { color: css('--ink-2') }, areaStyle: { color: css('--grid') } },
    labelFormatter: (v) => new Date(v).getFullYear() }];
  if (pts.length) {
    o.series = [{ name: 'Littlefield', type: 'line', showSymbol: false, sampling: 'lttb', lineStyle: { width: 1.5, color: css('--pen') }, itemStyle: { color: css('--pen') }, data: pts,
      markLine: cfg.record_high_cfs ? { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: css('--ink-2') },
        label: { color: css('--ink-2'), formatter: `Highest day ${fmtInt(cfg.record_high_cfs)} cfs` }, data: [{ yAxis: cfg.record_high_cfs }] } : undefined }];
  }
  const c = chart('chart-history');
  c.setOption(o, true);
  c.off('datazoom');
  c.on('datazoom', () => {
    if (!pts.length) return;
    const z = c.getOption().dataZoom[0];
    const span = pts[pts.length - 1][0] - pts[0][0];
    const a = new Date(+pts[0][0] + span * z.start / 100), e = new Date(+pts[0][0] + span * z.end / 100);
    histZoom = [a, e > new Date() ? new Date() : e];
    document.getElementById('hist-range').textContent = `Selected: ${fmtDay(histZoom[0], true)} – ${fmtDay(histZoom[1], true)}`;
  });
  const lead = document.getElementById('hist-lead');
  if (lead) {
    lead.textContent = cfg.record_days
      ? `Daily mean discharge at Littlefield, ${fmtDay(parseDay(cfg.record_start), true)} through ${fmtDay(parseDay(cfg.record_end), true)} (${fmtInt(cfg.record_days)} days). The highest day on that record is ${fmtInt(cfg.record_high_cfs)} cfs on ${fmtDay(parseDay(cfg.record_high_day), true)}. The line is the monthly mean, so a single flood day sits above it.`
      : 'The Littlefield daily record has not loaded.';
  }
  cite('src-history', 'USGS daily mean discharge, gauge ', link('09415000', USGS('09415000')), ', Virgin River at Littlefield, Arizona.');

  const years = (H.annual || []).filter(r => r.days >= 330);
  const a = base();
  a.aria.label = { enabled: true, description: `Acre-feet passing Littlefield each water year with a nearly complete daily record${years.length ? `, from ${years[0].water_year} to ${years[years.length - 1].water_year}` : ''}.` };
  a.tooltip = { ...a.tooltip, valueFormatter: (v) => v == null ? '—' : `${fmtInt(v)} acre-ft` };
  a.grid.bottom = 64; a.grid.top = 16;
  a.xAxis = { type: 'category', data: years.map(r => r.water_year), axisLabel: { color: css('--ink-2'), hideOverlap: true }, axisLine: { lineStyle: { color: css('--rule') } } };
  a.yAxis = { ...a.yAxis, axisLabel: { color: css('--ink-2'), formatter: (v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v } };
  a.dataZoom = [{ type: 'inside' }, { type: 'slider', height: 28, bottom: 8, borderColor: css('--rule'), textStyle: { color: css('--ink-2') } }];
  a.series = [{ name: 'Littlefield', type: 'bar', itemStyle: { color: css('--hydro') }, data: years.map(r => r.acre_ft) }];
  chart('chart-annual').setOption(a, true);
  cite('src-annual', 'USGS daily means at ', link('09415000', USGS('09415000')), '. A water year runs October through September and is named for the year it ends. Years with fewer than 330 daily values are left off the bars.');
  renderPanels(true);
}
document.getElementById('hist-apply').addEventListener('click', () => {
  if (!histZoom) return;
  fromIn.value = isoDay(histZoom[0]); toIn.value = isoDay(histZoom[1]);
  setKnobs({ hist: false }); if (!STATIC) form.requestSubmit();
});
