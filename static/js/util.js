// Small helpers shared by the page and the panels.
export const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const fmtInt = (v) => v == null || Number.isNaN(+v) ? '—' : nf0.format(v);
export const fmt1 = (v) => v == null || Number.isNaN(+v) ? '—' : new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
export const parseDay = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const parseHour = (s) => new Date(s.length > 10 ? s : s + 'T00:00');
export const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const fmtDay = (d, withYear) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
export const GAL_PER_AF = 325851;
export const pretty = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : fmtInt(n);
export const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.flat()); return e; };
export const b = (t) => el('b', { textContent: t });
export const USGS = (id) => `https://waterdata.usgs.gov/monitoring-location/${id}/`;
export const link = (text, href) => el('a', { textContent: text, href, rel: 'noreferrer' });
export const gaugeLinks = (ids) => ids.filter(Boolean).flatMap((id, i) => [i ? ', ' : '', link(id, USGS(id))]);
export const ACIS = () => link('NOAA ACIS', 'https://www.rcc-acis.org/');
export const cite = (id, ...parts) => { const e = document.getElementById(id); if (e) e.replaceChildren('Source: ', ...parts.flat()); };
export const ratioOf = (s) => s && s.latest_cfs != null && s.baseline_cfs > 0 ? s.latest_cfs / s.baseline_cfs : null;
export const timesNormal = (s) => {
  const r = ratioOf(s);
  if (r == null) return 'no data';
  if (r >= 0.85 && r < 1.15) return 'near the prior two weeks';
  return r < 1 ? `${Math.round(r * 100)}% of the prior two weeks` : `${r.toFixed(r < 10 ? 1 : 0)}× the prior two weeks`;
};
export const siteById = (D, id) => (D?.by_site || []).find(s => s.site_id === id);
