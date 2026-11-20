// Snow water equivalent at five SNOTEL stations, plus valley rain. sources/snotel.py and the core rain query.
(() => {
  const G = window.VRD;
  if (!G) return;
  const { el, b, link, cite, css, fmt1, fmtInt, parseDay, lineChart, emptyChart, barChart } = G;
  const AWDB = 'https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui/index.html';
  const SITE = (trip) => `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${trip.split(':')[0]}`;

  G.register({
    id: 'snotel', topic: 'sky', view: 'summary', order: 20,
    card(d) {
      if (!d || d.error || d.swe_in == null) return null;
      if (d.pct_median == null) return { val: `${fmt1(d.swe_in)} in`, sub: `average snow water on ${d.as_of || 'the latest day'}. The median for this date is still small, so a percent would not mean much.` };
      return { val: `${Math.round(d.pct_median)}%`, sub: `of the median snow water on ${d.as_of}, at the stations where the median is at least half an inch.` };
    },
    mount(slot) {
      const root = el('section', { className: 'section', id: 'snotel' },
        el('h2', { textContent: 'Snow in the mountains' }),
        el('p', { className: 'lead', id: 'snow-lead' }),
        el('div', { className: 'tiles', id: 'snow-tiles' }),
        el('div', { className: 'chart', id: 'chart-snow' }),
        el('p', { className: 'src', id: 'src-snow' }),
        el('h2', { id: 'rain-h', textContent: 'Rain in the basin' }),
        el('p', { className: 'note', id: 'rain-note' }),
        el('ul', { className: 'legend', 'aria-hidden': 'true' },
          el('li', {}, el('i', { className: 'on' }), 'Counted in the valley median, below 5,000 ft'),
          el('li', {}, el('i', { className: 'offk' }), 'Not counted (higher, or missing days)'),
          el('li', {}, el('i', { className: 'med' }), 'Valley median')),
        el('div', { className: 'chart', id: 'chart-rain' }),
        el('p', { className: 'src', id: 'src-rain' }));
      slot.append(root);
      return root;
    },
    render(d, D) {
      const lead = document.getElementById('snow-lead'), tiles = document.getElementById('snow-tiles');
      if (!d || d.error) {
        lead.textContent = d?.error || 'Snowpack is not available right now.';
        tiles.replaceChildren();
        emptyChart('chart-snow', 'No snow readings.');
      } else {
        if (d.pct_median == null) lead.replaceChildren(`On ${d.as_of || 'the latest day'}, the stations average `, b(`${fmt1(d.swe_in)} inches`), ' of water in the snow. A percent of median is withheld until the median itself is at least half an inch, so early-season traces are not turned into a big percentage.');
        else lead.replaceChildren(`Snow water is `, b(`${Math.round(d.pct_median)}% of the median`), ` for ${d.as_of}, averaged the way NRCS does it: the sum of the snow divided by the sum of those stations' medians. The plain average depth is ${fmt1(d.swe_in)} inches.`);
        tiles.replaceChildren(...(d.stations || []).map(s => el('div', { className: 'tile' },
          el('div', { className: 'lbl', textContent: s.name }),
          el('div', { className: 'val' }, el('span', { textContent: s.swe_in == null ? '—' : fmt1(s.swe_in) }), el('span', { className: 'unit', textContent: 'in' })),
          el('div', { className: 'sub', textContent: `median ${s.median_in == null ? '—' : fmt1(s.median_in)} in${s.pct == null ? '' : ` · ${Math.round(s.pct)}%`}${s.elev_ft ? ` · ${fmtInt(s.elev_ft)} ft` : ''}` }))));
        const byTrip = {};
        for (const p of d.series || []) (byTrip[p.triplet] ||= []).push(p);
        const colors = ['--pen', '--hydro', '--healthy', '--weber', '--jordan'];
        const series = (d.stations || []).map((s, i) => ({ name: s.name, color: css(colors[i]), points: (byTrip[s.triplet] || []).map(p => ({ t: parseDay(p.day), v: p.swe_in })) }));
        // Median for the first station, as a dashed comparison, is drawn as its own line when the grain is daily.
        const medName = (d.stations || [])[0];
        if (medName && d.grain !== 'monthly') {
          const medPts = (byTrip[medName.triplet] || []).filter(p => p.median_in != null).map(p => ({ t: parseDay(p.day), v: p.median_in }));
          if (medPts.length) series.push({ name: `${medName.name} median`, color: css('--ink-2'), points: medPts });
        }
        if (series.some(s => s.points.length)) lineChart('chart-snow', series, { fmt: fmt1, unit: ' in', zoom: true, alt: `Snow water equivalent. Basin index ${d.pct_median == null ? 'withheld' : d.pct_median + ' percent of median'}.` });
        else emptyChart('chart-snow', 'No snow readings in this span.');
        cite('src-snow', 'USDA NRCS SNOTEL via the ', link('Air and Water Database', AWDB), ', WTEQ daily and the daily median. Stations ',
          ...(d.stations || []).flatMap((s, i) => [i ? ', ' : '', link(s.name, SITE(s.triplet))]), '.');
      }
      const rain = D.rain_basin?.[0];
      document.getElementById('rain-note').textContent = rain?.rain_in == null
        ? 'No valley rain total for this period. Mountain stations are still listed when they reported.'
        : `The valley median is ${Number(rain.rain_in).toFixed(2)} inches, from ${rain.stations} stations below 5,000 feet that reported nearly every day. Mountain stations are drawn hollow and left out of that median, because the slopes get more than the valley floor.`;
      barChart('chart-rain', D.rain_stations || [], rain?.rain_in ?? null);
      cite('src-rain', link('NOAA ACIS', 'https://www.rcc-acis.org/'), ' MultiStnData, daily precipitation inside the Virgin basin box. Volunteer gauges report the morning after.');
    },
  });

  G.register({
    id: 'snotel', topic: 'sky', view: 'detail', order: 21,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'Each snow station' }),
        el('p', { className: 'note', textContent: 'Kolob and Webster Flat sit high above the east side of the basin, near Zion. Long Valley Junction is lower, on the east. Gardner Peak looks over the Santa Clara headwaters, and Gutz Peak is on the west side, toward the Beaver Dam Mountains. A station with a small median on this date does not get a percent.' }),
        el('div', { className: 'tablewrap', id: 'snow-table' }),
        el('p', { className: 'src', id: 'src-snow-detail' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const hold = document.getElementById('snow-table');
      if (!d || d.error) { hold.textContent = 'Snow stations are not available.'; return; }
      const table = el('table', {},
        el('caption', { textContent: `Snow water on ${d.as_of || 'the latest day'}, inches, and the NRCS median for that calendar day.` }),
        el('thead', {}, el('tr', {}, ...['Station', 'Elevation (ft)', 'Snow water (in)', 'Median (in)', 'Percent of median'].map(t => el('th', { scope: 'col', textContent: t })))),
        el('tbody', {}, ...(d.stations || []).map(s => el('tr', {},
          el('th', { scope: 'row' }, link(s.name, SITE(s.triplet))),
          el('td', { textContent: fmtInt(s.elev_ft) }), el('td', { textContent: s.swe_in == null ? '—' : fmt1(s.swe_in) }),
          el('td', { textContent: s.median_in == null ? '—' : fmt1(s.median_in) }),
          el('td', { textContent: s.pct == null ? '—' : `${Math.round(s.pct)}%` })))));
      hold.replaceChildren(table);
      cite('src-snow-detail', link('NRCS AWDB', AWDB), '.');
    },
  });

  G.register({
    id: 'snotel', topic: 'sky', view: 'history', order: 22,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'April 1 snowpack, by year' }),
        el('p', { className: 'note', textContent: 'April 1 is the date NRCS uses as a benchmark for the West\'s snowpack, even though melt in these mountains is often underway by then. Each bar group is one station\'s snow water on April 1. A missing year means that station did not report that day. The record starts in the early 1980s at Kolob and Webster Flat, and in 2004 at Gardner Peak and Gutz Peak.' }),
        el('div', { className: 'chart tall', id: 'chart-snow-hist' }),
        el('p', { className: 'src', id: 'src-snow-hist' }));
      slot.append(root);
      return root;
    },
    renderHistory(d) {
      if (!d || d.error || !(d.april1 || []).length) { emptyChart('chart-snow-hist', 'No April 1 record.'); return; }
      const years = [...new Set(d.april1.map(r => r.water_year))].sort((a, c) => a - c);
      const names = [...new Set(d.april1.map(r => r.name))];
      const colors = ['--pen', '--hydro', '--healthy', '--weber', '--jordan'];
      const o = G.base();
      o.aria.label = { enabled: true, description: `April 1 snow water equivalent by station from water year ${years[0]} to ${years[years.length - 1]}.` };
      o.legend = { top: 0, left: 0, textStyle: { color: css('--ink') }, icon: 'rect', itemHeight: 3 };
      o.grid.top = 36; o.grid.bottom = 48;
      o.xAxis = { type: 'category', data: years, axisLabel: { color: css('--ink-2'), hideOverlap: true }, axisLine: { lineStyle: { color: css('--rule') } } };
      o.yAxis = { ...o.yAxis, name: 'inches', axisLabel: { color: css('--ink-2') } };
      o.tooltip.valueFormatter = (v) => v == null ? '—' : `${fmt1(v)} in`;
      o.series = names.map((name, i) => ({ name, type: 'bar', itemStyle: { color: css(colors[i % colors.length]) },
        data: years.map(y => d.april1.find(r => r.water_year === y && r.name === name)?.swe_in ?? null) }));
      G.chart('chart-snow-hist').setOption(o, true);
      cite('src-snow-hist', link('NRCS SNOTEL', 'https://www.nrcs.usda.gov/wps/portal/wcc/home/aboutUs/monitoringPrograms/automatedSnowMonitoring/'), ' via AWDB. Water years are named for the year they end, so April 1 of 2026 is water year 2026.');
    },
  });
})();
