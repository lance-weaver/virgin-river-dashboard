// Monthly storage in Quail Creek, Sand Hollow, Gunlock, Kolob, and Ivins. sources/reservoirs.py.
(() => {
  const G = window.VRD;
  if (!G) return;
  const { el, b, link, cite, css, fmtInt, fmt1, parseDay, lineChart, emptyChart } = G;
  const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui/index.html';
  const monthName = (iso) => iso ? parseDay(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—';

  G.register({
    id: 'reservoirs', topic: 'reservoirs', view: 'summary', order: 10,
    card(d) {
      const t = d?.total;
      if (!d || d.error || t?.pct == null) return null;
      return { val: `${fmt1(t.pct)}%`, sub: `of combined capacity, end of ${monthName(d.as_of)}. Monthly NRCS, not today's telemetry.` };
    },
    mount(slot) {
      const root = el('section', { className: 'section', id: 'reservoirs' },
        el('h2', { textContent: 'Reservoir storage' }),
        el('p', { className: 'callout', textContent: 'These are end-of-month storage values from NRCS. Daily storage is not published for these reservoirs. The figure is not this morning\'s WCWCD operations number. Daily telemetry can be added later beside this record.' }),
        el('p', { className: 'lead', id: 'res-lead' }),
        el('div', { className: 'tiles', id: 'res-tiles' }),
        el('div', { className: 'chart', id: 'chart-res' }),
        el('p', { className: 'src', id: 'src-res' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const lead = document.getElementById('res-lead'), tiles = document.getElementById('res-tiles');
      if (!d || d.error) {
        lead.textContent = d?.error || 'Reservoir storage is not available right now.';
        tiles.replaceChildren();
        emptyChart('chart-res', 'No monthly storage loaded.');
        cite('src-res', link('NRCS AWDB', AWDB), ', element RESC, monthly.');
        return;
      }
      const t = d.total || {};
      lead.replaceChildren('Together the five reservoirs held ', b(`${fmtInt(t.storage_af)} acre-feet`), ` at the end of ${monthName(d.as_of)}, `, b(`${fmt1(t.pct)}%`), ` of their ${fmtInt(t.capacity_af)} acre-foot combined capacity.`);
      tiles.replaceChildren(...(d.reservoirs || []).map(r => el('div', { className: 'tile' },
        el('div', { className: 'lbl', textContent: r.name }),
        el('div', { className: 'val' }, el('span', { textContent: r.pct == null ? '—' : fmt1(r.pct) }), el('span', { className: 'unit', textContent: r.pct == null ? '' : '%' })),
        el('div', { className: 'sub', textContent: r.storage_af == null ? 'No month-end value' : `${fmtInt(r.storage_af)} of ${fmtInt(r.capacity_af)} acre-ft${r.change_af == null ? '' : ` · ${r.change_af >= 0 ? '+' : ''}${fmtInt(r.change_af)} from the month before`}` }))));
      const byId = {};
      for (const p of d.series || []) (byId[p.id] ||= []).push(p);
      const colors = ['--pen', '--hydro', '--healthy', '--weber', '--jordan'];
      const series = (d.reservoirs || []).map((r, i) => ({ name: r.name, color: css(colors[i]), points: (byId[r.id] || []).map(p => ({ t: parseDay(p.month), v: p.af })) }));
      if (series.some(s => s.points.length)) lineChart('chart-res', series, { fmt: fmtInt, unit: ' acre-ft', zoom: true, alt: `End-of-month storage. Combined they are ${fmt1(t.pct)} percent full as of ${d.as_of}.` });
      else emptyChart('chart-res', 'No monthly storage in this span.');
      cite('src-res', link('NRCS Air and Water Database', AWDB), ', RESC monthly, stations 09UTQUAI, 09UTSAND, 09UTGUNL, 09UTKOLB, 09UTIVIN. Capacity from station metadata. ', d.note || '');
    },
  });

  G.register({
    id: 'reservoirs', topic: 'reservoirs', view: 'detail', order: 11,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'Month by month' }),
        el('p', { className: 'note', textContent: 'End-of-month storage and the share of each reservoir\'s published capacity. A change is versus the previous month in this table. Quail Creek and Sand Hollow are the two large Washington County reservoirs; Gunlock sits on the Santa Clara, Kolob is high in the drainage, and Ivins is small.' }),
        el('div', { className: 'tablewrap', id: 'res-table' }),
        el('p', { className: 'src', id: 'src-res-detail' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const hold = document.getElementById('res-table');
      if (!d || d.error) { hold.textContent = d?.error || 'No monthly table.'; return; }
      const names = Object.fromEntries((d.reservoirs || []).map(r => [r.id, r.name]));
      const caps = Object.fromEntries((d.reservoirs || []).map(r => [r.id, r.capacity_af]));
      const rows = [...(d.series || [])].reverse();
      const table = el('table', {},
        el('caption', { textContent: 'End-of-month storage, newest first. Capacity is the NRCS station metadata value, in acre-feet.' }),
        el('thead', {}, el('tr', {}, ...['Month', 'Reservoir', 'Storage (acre-ft)', 'Capacity (acre-ft)', 'Percent full'].map(t => el('th', { scope: 'col', textContent: t })))),
        el('tbody', {}, ...rows.map(r => el('tr', {},
          el('td', { textContent: r.month }), el('td', { textContent: names[r.id] || r.id }),
          el('td', { textContent: fmtInt(r.af) }), el('td', { textContent: fmtInt(caps[r.id]) }),
          el('td', { textContent: caps[r.id] ? fmt1(100 * r.af / caps[r.id]) : '—' })))));
      hold.replaceChildren(table);
      cite('src-res-detail', link('NRCS AWDB', AWDB), '. Daily WCWCD telemetry is not connected; this table stays monthly until it is.');
    },
  });

  G.register({
    id: 'reservoirs', topic: 'reservoirs', view: 'history', order: 12,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'Storage since the reservoirs came online' }),
        el('p', { className: 'note', textContent: 'Every month NRCS has published for these five reservoirs, back to the mid-1980s for Quail Creek. The shape of the year is the same most years: fill in spring, draw down through summer and fall. Sand Hollow and Quail Creek dominate the acre-feet. This is still a monthly series. It is the public record, not a reconstruction of daily operations.' }),
        el('div', { className: 'chart tall', id: 'chart-res-hist' }),
        el('p', { className: 'src', id: 'src-res-hist' }));
      slot.append(root);
      return root;
    },
    renderHistory(d) {
      if (!d || d.error) { emptyChart('chart-res-hist', 'No reservoir history.'); return; }
      const byId = {};
      for (const p of d.series || []) (byId[p.id] ||= []).push(p);
      const colors = ['--pen', '--hydro', '--healthy', '--weber', '--jordan'];
      const series = (d.reservoirs || []).map((r, i) => ({ name: r.name, color: css(colors[i]), points: (byId[r.id] || []).map(p => ({ t: parseDay(p.month), v: p.af })) }));
      lineChart('chart-res-hist', series, { fmt: fmtInt, unit: ' acre-ft', zoom: true, alt: 'Monthly reservoir storage for the full NRCS record.' });
      cite('src-res-hist', link('NRCS AWDB', AWDB), ', RESC monthly.');
    },
  });
})();
