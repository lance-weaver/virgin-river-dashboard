// Lake Powell and Lake Mead. sources/colorado.py. Context for the Virgin, which enters Lake Mead.
(() => {
  const G = window.VRD;
  if (!G) return;
  const { el, b, link, cite, css, fmtInt, fmt1, parseDay, lineChart, emptyChart } = G;
  const HYDRO = 'https://www.usbr.gov/uc/water/hydrodata/';

  function lakeTiles(lakes) {
    return el('div', { className: 'tiles' }, ...(lakes || []).map(L => el('div', { className: 'tile' },
      el('div', { className: 'lbl', textContent: L.name }),
      el('div', { className: 'val' }, el('span', { textContent: L.elev_ft == null ? '—' : fmt1(L.elev_ft) }), el('span', { className: 'unit', textContent: 'ft' })),
      el('div', { className: 'sub', textContent: L.storage_af == null ? '' : `${fmtInt(L.storage_af)} acre-ft · ${fmt1(L.pct)}% of ${fmtInt(L.capacity_af)}` }),
      el('div', { className: 'sub', textContent: L.day ? `Reading ${L.day}. ${L.capacity_note}` : L.capacity_note }))));
  }

  G.register({
    id: 'colorado', topic: 'colorado', view: 'summary', order: 50,
    mount(slot) {
      const root = el('section', { className: 'section', id: 'colorado' },
        el('h2', { textContent: 'Powell and Mead' }),
        el('p', { className: 'lead', id: 'col-lead' }),
        el('div', { id: 'col-tiles' }),
        el('div', { className: 'chart', id: 'chart-col' }),
        el('p', { className: 'note', id: 'col-refs' }),
        el('p', { className: 'src', id: 'src-col' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const lead = document.getElementById('col-lead'), tiles = document.getElementById('col-tiles'), refs = document.getElementById('col-refs');
      if (!d || d.error) {
        lead.textContent = d?.error || 'Powell and Mead are not available right now.';
        tiles.replaceChildren();
        emptyChart('chart-col', 'No reservoir series.');
        return;
      }
      const powell = (d.lakes || []).find(L => L.id === 'powell'), mead = (d.lakes || []).find(L => L.id === 'mead');
      lead.replaceChildren('The Virgin River joins the Colorado in Lake Mead. ',
        powell?.elev_ft != null ? `Powell, upstream on the Colorado, is at ` : '',
        powell?.elev_ft != null ? b(`${fmt1(powell.elev_ft)} ft`) : '',
        powell?.pct != null ? ` (${fmt1(powell.pct)}% of live capacity). ` : '. ',
        mead?.elev_ft != null ? `Mead is at ` : '',
        mead?.elev_ft != null ? b(`${fmt1(mead.elev_ft)} ft`) : '',
        mead?.pct != null ? ` (${fmt1(mead.pct)}% of the active capacity used here).` : '.');
      tiles.replaceChildren(lakeTiles(d.lakes));
      const series = (d.lakes || []).map(L => ({
        name: L.name, color: css(L.id === 'powell' ? '--pen' : '--hydro'),
        points: (d.series || []).filter(p => p.lake === L.id && p.storage_af != null).map(p => ({ t: parseDay(p.day), v: p.storage_af })),
      }));
      if (series.some(s => s.points.length)) lineChart('chart-col', series, { fmt: fmtInt, unit: ' acre-ft', zoom: true,
        alt: `Storage in Lake Powell and Lake Mead. ${powell ? 'Powell ' + fmt1(powell.pct) + ' percent.' : ''} ${mead ? 'Mead ' + fmt1(mead.pct) + ' percent.' : ''}` });
      else emptyChart('chart-col', 'No storage series in this span.');
      const lines = (d.lakes || []).flatMap(L => (L.refs || []).map(r => `${L.name}: ${r.label}`));
      refs.textContent = `Reference levels, not drawn on the storage chart because storage and elevation are different axes. ${lines.join(' ')} The 2007 Interim Guideline tiers are the ones operators have used through 2026; check the current USBR 24-month study before treating a tier as this year\'s operating rule.`;
      cite('src-col', link('USBR hydrodata', HYDRO), ' Powell 919/49 and 919/17, Mead 921/49 and 921/17. ',
        d.source === 'rise' ? 'This build fell back to USBR RISE. ' : 'RISE is the fallback if those files fail. ',
        d.note || '');
    },
  });

  G.register({
    id: 'colorado', topic: 'colorado', view: 'detail', order: 51,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'What the percent means' }),
        el('p', { className: 'note', textContent: 'Storage and elevation come straight from the USBR files. The percent does not. Powell\'s percent divides that storage by 23.314 million acre-feet, the total live storage USBR states at elevation 3,700 feet. On 27 October 2024 the hydrodata file and USBR\'s own monthly summary both show about 9.06 million acre-feet at 3,577.04 feet, so the file is live storage, not a different zero. Mead\'s percent divides storage by 26.12 million acre-feet, a published active capacity near elevation 1,220 feet. If either capacity is revised by a new survey, the percent moves and the acre-feet do not. Minimum power pool at Powell is 3,490 feet. Mead elevations near 1,050 to 1,075 feet are the shortage tiers of the 2007 Interim Guidelines.' }),
        el('div', { id: 'col-detail' }),
        el('p', { className: 'src', id: 'src-col-detail' }));
      slot.append(root);
      return root;
    },
    render(d) {
      const hold = document.getElementById('col-detail');
      if (!d || d.error) { hold.textContent = 'No Powell or Mead detail.'; return; }
      const table = el('table', {},
        el('caption', { textContent: 'Latest daily value in the USBR series, and the capacity used to compute a percent.' }),
        el('thead', {}, el('tr', {}, ...['Reservoir', 'Date', 'Elevation (ft)', 'Storage (acre-ft)', 'Capacity used (acre-ft)', 'Percent'].map(t => el('th', { scope: 'col', textContent: t })))),
        el('tbody', {}, ...(d.lakes || []).map(L => el('tr', {},
          el('th', { scope: 'row', textContent: L.name }),
          el('td', { textContent: L.day || '—' }),
          el('td', { textContent: L.elev_ft == null ? '—' : fmt1(L.elev_ft) }),
          el('td', { textContent: fmtInt(L.storage_af) }),
          el('td', { textContent: fmtInt(L.capacity_af) }),
          el('td', { textContent: L.pct == null ? '—' : `${fmt1(L.pct)}%` })))));
      hold.replaceChildren(table);
      cite('src-col-detail', link('USBR', HYDRO), '. Powell live capacity 23,314,000 acre-feet at 3,700 ft, from the USBR CRSP monthly reservoir summary. Mead active capacity 26,120,000 acre-feet.');
    },
  });

  G.register({
    id: 'colorado', topic: 'colorado', view: 'history', order: 52,
    mount(slot) {
      const root = el('section', { className: 'section' },
        el('h2', { textContent: 'Storage since the dams filled' }),
        el('p', { className: 'note', textContent: 'Monthly mean storage. Lake Mead\'s series begins in the 1930s, after Hoover Dam. Lake Powell\'s begins in 1963, as Glen Canyon Dam closed and the reservoir filled, reaching a full pool in the early 1980s and spending the years since the early 2000s well below it. The Virgin River is a small tributary of this system. It enters Mead, so Mead\'s elevation is the pool the Virgin flows toward, and Powell\'s elevation is the storage decision that determines how much Colorado River water reaches that pool.' }),
        el('div', { className: 'chart tall', id: 'chart-col-hist' }),
        el('p', { className: 'src', id: 'src-col-hist' }));
      slot.append(root);
      return root;
    },
    renderHistory(d) {
      if (!d || d.error) { emptyChart('chart-col-hist', 'No Powell or Mead history.'); return; }
      // Storage, not elevation: Powell sits near 3,500 ft and Mead near 1,050 ft, so one elevation axis hides Mead.
      const stor = (d.lakes || []).map(L => ({
        name: L.name, color: css(L.id === 'powell' ? '--pen' : '--hydro'),
        points: (d.series || []).filter(p => p.lake === L.id && p.storage_af != null).map(p => ({ t: parseDay(p.day), v: p.storage_af })),
      }));
      if (stor.some(s => s.points.length)) lineChart('chart-col-hist', stor, { fmt: fmtInt, unit: ' acre-ft', zoom: true,
        alt: 'Monthly mean storage in Lake Powell and Lake Mead for the full USBR record.' });
      else emptyChart('chart-col-hist', 'No history loaded.');
      cite('src-col-hist', link('USBR hydrodata', HYDRO), ' daily storage, averaged by month. Powell from 1963, Mead from the 1930s.');
    },
  });
})();
