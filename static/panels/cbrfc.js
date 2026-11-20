// CBRFC water-supply forecasts for area VG, and the Hurricane short-range hydrograph. sources/cbrfc.py.
(() => {
  const G = window.VRD;
  if (!G) return;
  const { el, b, link, cite, css, fmtInt, fmt1, parseHour, lineChart, emptyChart } = G;
  const BASE = 'https://www.cbrfc.noaa.gov';

  function pointTable(issue) {
    if (!issue) return el('p', { textContent: 'No official forecast is stored.' });
    const heads = ['Point', '90%', '70%', '50%', '30%', '10%', 'Average', 'Median', '% of median'];
    return el('table', { className: 'cbrfc-tbl' },
      el('caption', { textContent: `Official April–July forecast issued ${issue.issued}, thousand acre-feet. A 90% volume is one the river is expected to exceed in 9 years out of 10. A 10% volume is the high end.` }),
      el('thead', {}, el('tr', {}, ...heads.map(t => el('th', { scope: 'col', textContent: t })))),
      el('tbody', {}, ...issue.points.map(p => el('tr', {},
        el('th', { scope: 'row' }, link(p.name, `${BASE}/wsup/graph/espgraph_hc.html?id=${p.id}&year=${issue.water_year}`)),
        ...[p.p90, p.p70, p.p50, p.p30, p.p10, p.avg, p.med].map(v => el('td', { textContent: v == null ? '—' : fmt1(v) })),
        el('td', { textContent: p.pct_med == null ? '—' : `${Math.round(p.pct_med)}%` })))));
  }

  G.register({
    id: 'cbrfc', topic: 'forecast', view: 'summary', order: 40,
    mount(slot) {
      const root = el('section', { className: 'section', id: 'cbrfc' },
        el('h2', { textContent: 'April–July water supply' }),
        el('p', { className: 'lead', id: 'cbrfc-lead' }),
        el('p', { className: 'callout', id: 'cbrfc-note', hidden: true }),
        el('div', { className: 'tablewrap', id: 'cbrfc-latest' }),
        el('h2', { textContent: 'Hurricane, the next 10 days' }),
        el('p', { className: 'note', textContent: 'CBRFC\'s short-range deterministic forecast at HURU1, Virgin River near Hurricane, in cubic feet per second. Observed hours are the solid trace. The forecast is the continuation. Horizontal lines, when the river is anywhere near them, are the action and flood flows CBRFC carries for this point. Most days the river is far below them; the lines are omitted from the chart so the ordinary flow stays readable, and the levels are written under the chart.' }),
        el('div', { className: 'chart', id: 'chart-flow' }),
        el('p', { className: 'src', id: 'src-cbrfc' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const lead = document.getElementById('cbrfc-lead'), note = document.getElementById('cbrfc-note');
      const hold = document.getElementById('cbrfc-latest');
      if (!d || d.error) {
        lead.textContent = d?.error || 'CBRFC forecasts are not available right now.';
        hold.replaceChildren();
        emptyChart('chart-flow', 'No Hurricane forecast.');
        return;
      }
      const latest = d.latest;
      if (!latest) lead.textContent = 'No official Virgin River water-supply forecast is in the archive yet.';
      else {
        const virgin = latest.points.find(p => p.id === 'VIRU1');
        lead.replaceChildren(`Latest official issue, ${latest.issued}. `,
          virgin ? `Virgin at Virgin, most probable (50%) April–July volume: ` : '',
          virgin ? b(`${fmt1(virgin.p50)} thousand acre-feet`) : '',
          virgin && virgin.pct_med != null ? `, ${Math.round(virgin.pct_med)}% of the median. ` : '. ',
          `The area code is VG. CBRFC publishes two points here: Virgin at Virgin, and Santa Clara near Pine Valley.`);
      }
      if (d.note) { note.hidden = false; note.textContent = d.note; } else note.hidden = true;
      hold.replaceChildren(pointTable(latest));
      const flow = d.flow || {};
      const series = [];
      if (flow.observed?.length) series.push({ name: 'Observed', color: css('--ink'), points: flow.observed.map(p => ({ t: parseHour(p.t), v: p.cfs })) });
      if (flow.forecast?.length) series.push({ name: 'Forecast', color: css('--pen'), points: flow.forecast.map(p => ({ t: parseHour(p.t), v: p.cfs })) });
      if (series.length) lineChart('chart-flow', series, { fmt: fmtInt, unit: ' cfs', zoom: true,
        alt: `Hurricane flow, observed and forecast. ${flow.issued ? 'Forecast issued ' + flow.issued + '.' : ''}` });
      else emptyChart('chart-flow', 'The Hurricane flow forecast did not load.');
      const crit = flow.critical || {};
      cite('src-cbrfc', link('CBRFC', BASE), ` water supply, area VG. Short-range flow at `,
        link('HURU1', `${BASE}/dbdata/station/flowgraph/flowgraph_hc.html?id=HURU1&ptype=1`),
        crit.action_cfs ? `. Action flow about ${fmtInt(crit.action_cfs)} cfs, flood flow about ${fmtInt(crit.flood_cfs)} cfs.` : '.',
        ' Volumes in the table are thousand acre-feet of April through July runoff.');
    },
  });

  G.register({
    id: 'cbrfc', topic: 'forecast', view: 'detail', order: 41,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'How the forecast is issued' }),
        el('p', { className: 'note', textContent: 'CBRFC issues an official April–July volume on the first of each month from January through June, for the Virgin area (VG). Between those dates the numbers do not change on this page. In the fall and early winter there is no new official issue; the page keeps the last one and says so. The 50% value is the most probable volume. The 90% and 10% values bracket a wide range, and a desert river regularly uses all of it. Santa Clara near Pine Valley is a small volume next to the Virgin at Virgin. Neither point is Hurricane; Hurricane\'s short-range forecast is the chart on the summary.' }),
        el('div', { className: 'tablewrap', id: 'cbrfc-detail' }),
        el('p', { className: 'src', id: 'src-cbrfc-detail' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const hold = document.getElementById('cbrfc-detail');
      if (!d || d.error || !d.latest) { hold.textContent = 'No forecast table.'; return; }
      hold.replaceChildren(pointTable(d.latest));
      cite('src-cbrfc-detail', link('CBRFC water-supply documents', `${BASE}/wsup/doc/doc.html`), '. Official discussion: ', link('current PDF', `${BASE}/wsup/pub2/discussion/current.pdf`), '.');
    },
  });

  G.register({
    id: 'cbrfc', topic: 'forecast', view: 'history', order: 42,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'Official issues on file' }),
        el('p', { className: 'note', textContent: 'Every January-through-June official issue this dashboard has pulled for area VG, most probable (50%) volume in thousand acre-feet. A water year\'s six issues should tighten as April, May, and June bring the observed runoff into the forecast. The archive online at CBRFC is short compared with the Littlefield gauge record; this table is only the recent seasons, not a reconstruction back to 1929.' }),
        el('div', { className: 'tablewrap', id: 'cbrfc-hist' }),
        el('p', { className: 'src', id: 'src-cbrfc-hist' }));
      slot.append(root);
      return root;
    },
    renderHistory(d) {
      const hold = document.getElementById('cbrfc-hist');
      if (!d || d.error) { hold.textContent = 'No forecast archive.'; return; }
      const issues = [...(d.issues || [])].reverse();
      const ids = [...new Set(issues.flatMap(i => i.points.map(p => p.id)))];
      const table = el('table', {},
        el('caption', { textContent: 'Most probable April–July volume, thousand acre-feet, by official issue date.' }),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', textContent: 'Issued' }), ...ids.map(id => el('th', { scope: 'col', textContent: id })))),
        el('tbody', {}, ...issues.map(i => el('tr', {},
          el('th', { scope: 'row', textContent: i.issued }),
          ...ids.map(id => el('td', { textContent: fmt1(i.points.find(p => p.id === id)?.p50) }))))));
      hold.replaceChildren(table);
      cite('src-cbrfc-hist', link('CBRFC', BASE), ' wsocond_data, area VG.');
    },
  });
})();
