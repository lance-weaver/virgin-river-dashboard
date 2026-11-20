// Shared page state. main.js fills DATA for the chosen dates and HIST for the long record.
export const state = { DATA: null, HIST: null };
// The GitHub Pages copy has no server: the export writes the same JSON under data/ and sets VRD_STATIC.
export const STATIC = window.VRD_STATIC || null;
export const api = {
  panels: () => fetch(STATIC ? 'data/panels.json' : '/api/panels'),
  history: () => fetch(STATIC ? 'data/history.json' : '/api/history'),
  data: (from, to) => {
    if (!STATIC) return fetch(`/api/data?${new URLSearchParams({ from, to })}`);
    const w = STATIC.windows.find(x => x.from === from && x.to === to);
    if (!w) return Promise.resolve(new Response(JSON.stringify({ error: 'This published copy only has the preset periods. Run the dashboard locally for other dates.' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    return fetch(w.file);
  },
};
