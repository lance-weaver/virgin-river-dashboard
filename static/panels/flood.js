// NWS flood categories and USGS turbidity. sources/flood.py. The Hurricane hydrograph forecast is on the Forecasts panel.
(() => {
  const G = window.VRD;
  if (!G) return;
  const { el, link, cite, css, fmtInt, fmt1, parseDay, parseHour, lineChart, emptyChart } = G;
  const pill = (cat, label) => {
    const cls = cat === 'no_flooding' || cat === 'none' ? 'ok' : cat === 'action' ? 'action' : (cat ? 'flood' : '');
    return el('span', { className: `pill ${cls}`, textContent: label || 'Unknown' });
  };

  G.register({
    id: 'flood', topic: 'flood', view: 'summary', order: 30,
    card(d) {
      const g = (d?.gauges || []).find(x => x.lid === 'HURU1') || d?.gauges?.[0];
      if (!d || d.error || !g) return null;
      const obs = g.observed || {};
      return { val: obs.category_label || '—', sub: `${g.name}. Stage ${obs.stage_ft == null ? '—' : fmt1(obs.stage_ft)} ft.` };
    },
    mount(slot) {
      const root = el('section', { className: 'section', id: 'flood' },
        el('h2', { textContent: 'Flood stage' }),
        el('p', { className: 'note', textContent: 'National Weather Service flood categories at three Virgin River gauges. Action stage is the level where the Weather Service wants people watching. Minor, moderate, and major are the flood categories above that. A forecast category is the NWS short-range forecast, not a guarantee.' }),
        el('div', { id: 'flood-gauges' }),
        el('h2', { textContent: 'Turbidity' }),
        el('p', { className: 'note', textContent: 'USGS turbidity at Virgin (09406000), below the canyon, and on the Santa Clara near Pine Valley (09408400). It is a reading of how cloudy the water is, in FNU. It jumps when a storm moves sediment. It is not a tonnage of sediment, and it is not measured at Hurricane.' }),
        el('div', { className: 'chart', id: 'chart-turb' }),
        el('p', { className: 'src', id: 'src-flood' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const hold = document.getElementById('flood-gauges');
      if (!d || d.error) {
        hold.textContent = d?.error || 'Flood categories are not available right now.';
        emptyChart('chart-turb', 'No turbidity.');
        return;
      }
      hold.replaceChildren(el('div', { className: 'tiles' }, ...(d.gauges || []).map(g => {
        const obs = g.observed || {}, fc = g.forecast || {}, cats = g.categories || {};
        const line = (k, label) => cats[k]?.stage_ft == null ? '' : `${label} ${cats[k].stage_ft} ft`;
        return el('div', { className: 'tile' },
          el('div', { className: 'lbl', textContent: `${g.name} (${g.lid})` }),
          el('div', { className: 'val' }, pill(obs.category, obs.category_label)),
          el('div', { className: 'sub', textContent: `Stage ${obs.stage_ft == null ? '—' : fmt1(obs.stage_ft)} ft${obs.flow_kcfs == null ? '' : ` · about ${fmtInt(obs.flow_kcfs * 1000)} cfs`}` }),
          el('div', { className: 'sub', textContent: `Forecast: ${fc.category_label || '—'}${fc.stage_ft == null ? '' : `, ${fmt1(fc.stage_ft)} ft`}` }),
          el('div', { className: 'sub', textContent: [line('action', 'Action'), line('minor', 'Minor'), line('moderate', 'Moderate'), line('major', 'Major')].filter(Boolean).join(' · ') }));
      })));
      const series = (d.turbidity || []).map((t, i) => ({
        name: t.name, color: css(i ? '--hydro' : '--pen'),
        points: (t.series || []).map(p => ({ t: String(p.t).length > 10 ? parseHour(p.t) : parseDay(p.t), v: p.v })),
      }));
      if (series.some(s => s.points.length)) lineChart('chart-turb', series, { fmt: fmtInt, unit: ' FNU', zoom: true,
        alt: `Turbidity. ${(d.turbidity || []).map(t => `${t.name} latest ${t.latest_fnu == null ? 'unavailable' : t.latest_fnu + ' FNU'}`).join('. ')}.` });
      else emptyChart('chart-turb', 'No turbidity readings in this period. The gauges still report stage above.');
      cite('src-flood', 'Flood categories from the ', link('NWS NWPS API', 'https://api.water.noaa.gov/nwps/v1/gauges'), ' for HURU1, VIRU1, and VLTA3. Turbidity from USGS parameter 63680 at ',
        link('09406000', 'https://waterdata.usgs.gov/monitoring-location/09406000/'), ' and ',
        link('09408400', 'https://waterdata.usgs.gov/monitoring-location/09408400/'), '. ', d.note || '');
    },
  });

  G.register({
    id: 'flood', topic: 'flood', view: 'detail', order: 31,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'Stages and categories' }),
        el('p', { className: 'note', textContent: 'The same three gauges, with the flow that NWS pairs with each category. Flow here is the rating at that stage, in cubic feet per second, and it will not match the USGS discharge exactly when the rating and the gauge disagree. Hurricane (HURU1) is the gauge that matters for St. George and the reservoirs. Virgin (VIRU1) is upstream, below Zion. Littlefield (VLTA3) is in Arizona, where the river leaves the basin.' }),
        el('div', { className: 'tablewrap', id: 'flood-table' }),
        el('p', { className: 'src', id: 'src-flood-detail' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const hold = document.getElementById('flood-table');
      if (!d || d.error) { hold.textContent = 'No flood table.'; return; }
      const heads = ['Gauge', 'Now', 'Stage (ft)', 'Flow (cfs)', 'Forecast', 'Action (ft)', 'Minor (ft)', 'Moderate (ft)', 'Major (ft)'];
      const flow = (kcfs) => kcfs == null ? '—' : fmtInt(kcfs * 1000);
      const stage = (cats, k) => cats?.[k]?.stage_ft == null ? '—' : fmt1(cats[k].stage_ft);
      const table = el('table', {},
        el('caption', { textContent: 'NWS flood categories. Flow next to the current stage is the NWS secondary reading, converted from thousand cfs.' }),
        el('thead', {}, el('tr', {}, ...heads.map(t => el('th', { scope: 'col', textContent: t })))),
        el('tbody', {}, ...(d.gauges || []).map(g => el('tr', {},
          el('th', { scope: 'row', textContent: `${g.lid} · ${g.name}` }),
          el('td', { textContent: g.observed?.category_label || '—' }),
          el('td', { textContent: g.observed?.stage_ft == null ? '—' : fmt1(g.observed.stage_ft) }),
          el('td', { textContent: flow(g.observed?.flow_kcfs) }),
          el('td', { textContent: g.forecast?.category_label || '—' }),
          el('td', { textContent: stage(g.categories, 'action') }),
          el('td', { textContent: stage(g.categories, 'minor') }),
          el('td', { textContent: stage(g.categories, 'moderate') }),
          el('td', { textContent: stage(g.categories, 'major') })))));
      hold.replaceChildren(table);
      cite('src-flood-detail', link('NWS National Water Prediction Service', 'https://water.noaa.gov/'), '.');
    },
  });

  G.register({
    id: 'flood', topic: 'flood', view: 'history', order: 32,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'Historic crests' }),
        el('p', { className: 'note', textContent: 'The highest crests NWS keeps for these three gauges. A crest is a peak stage during a flood, with the flow estimated at the time. Older crests are sometimes on an older datum, so the stage is not perfectly comparable with today\'s gauge. The dates are the ones to remember on this river: the winter floods of 1966, 2005, and 2010, and the monsoon peaks. This list is the NWS historic-crest table, not a complete flood history.' }),
        el('div', { className: 'tablewrap', id: 'crest-table' }),
        el('p', { className: 'src', id: 'src-crests' }));
      slot.append(root);
      return root;
    },
    renderHistory(d) {
      const hold = document.getElementById('crest-table');
      if (!d || d.error) { hold.textContent = 'Historic crests are not available.'; return; }
      const rows = d.crests || [];
      const table = el('table', {},
        el('caption', { textContent: 'Historic crests reported by the National Weather Service for HURU1, VIRU1, and VLTA3.' }),
        el('thead', {}, el('tr', {}, ...['Gauge', 'Date', 'Stage (ft)', 'Flow (cfs)'].map(t => el('th', { scope: 'col', textContent: t })))),
        el('tbody', {}, ...rows.map(c => el('tr', {},
          el('th', { scope: 'row', textContent: `${c.lid} · ${c.name}` }),
          el('td', { textContent: (c.time || '').slice(0, 10) }),
          el('td', { textContent: c.stage_ft == null ? '—' : fmt1(c.stage_ft) }),
          el('td', { textContent: c.flow_cfs == null ? '—' : fmtInt(c.flow_cfs) })))));
      hold.replaceChildren(table);
      cite('src-crests', link('NWS NWPS', 'https://api.water.noaa.gov/nwps/v1/gauges'), ' historic crests.');
    },
  });
})();
