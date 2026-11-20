// Three controls: topic, period (or Since 1929), and view. Every block in #stage carries data-topic and data-view.
export const TOPICS = {
  glance: 'At a glance', river: 'River', reservoirs: 'Reservoirs', sky: 'Snow and rain',
  flood: 'Flood and sediment', forecast: 'Forecasts', colorado: 'Powell and Mead',
};
export const VIEWS = { summary: 'Summary', map: 'Map', detail: 'Detail' };
export const knobs = { topic: 'glance', view: 'summary', hist: false };

export function fits(n) {
  const v = n.dataset.view;
  if (v === 'period') return !knobs.hist;
  if (knobs.topic === 'glance') return n.dataset.topic.split(' ').includes('glance');
  if (!n.dataset.topic.split(' ').some(t => t === 'all' || t === knobs.topic)) return false;
  if (knobs.view === 'map') return v === 'map';
  return knobs.hist ? v === 'history' : v === knobs.view;
}
export function showKnobs() {
  for (const [id, on] of [['topic', knobs.topic], ['view', knobs.view]])
    for (const b of document.querySelectorAll(`#${id} button`)) b.setAttribute('aria-pressed', b.value === on);
  for (const n of document.querySelectorAll('main [data-view]')) n.hidden = !fits(n);
  const glance = knobs.topic === 'glance';
  document.querySelector('main').classList.toggle('glance', glance);
  document.getElementById('view').closest('.knob').hidden = glance;
  const facts = document.getElementById('stage-facts');
  facts.hidden = ![...facts.children].some(c => !c.hidden);
  const shown = [...document.querySelectorAll('#stage [data-view]')].some(n => !n.hidden);
  const empty = document.getElementById('stage-empty');
  empty.hidden = shown;
  empty.textContent = shown ? '' : knobs.hist
    ? `${TOPICS[knobs.topic]} does not have a record back to 1929. Pick a shorter period.`
    : `Nothing for ${TOPICS[knobs.topic].toLowerCase()} in the ${VIEWS[knobs.view].toLowerCase()} view.`;
}
export function knobQuery(from, to) {
  const q = new URLSearchParams({ from, to });
  if (knobs.topic !== 'glance') q.set('topic', knobs.topic);
  if (knobs.view !== 'summary') q.set('view', knobs.view);
  if (knobs.hist) q.set('period', 'all');
  return `?${q}`;
}
export function readKnobs(qs) {
  if (qs.get('topic') in TOPICS) knobs.topic = qs.get('topic');
  if (qs.get('view') in VIEWS) knobs.view = qs.get('view');
  if (qs.get('period') === 'all') knobs.hist = true;
  if (knobs.hist && knobs.topic === 'glance') knobs.topic = 'river';
}
