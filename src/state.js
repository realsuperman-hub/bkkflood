// Tiny shared state + change notification (no framework).
const SAVED_KEY = 'bkkflood.places';
const loadSaved = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    return Array.isArray(v) ? v.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 4) : [];
  } catch {
    return [];
  }
};

export const state = {
  store: null,
  map: null,
  stations: [],
  stationsAt: null,
  stationsSrc: '',
  stationsError: null,
  rainObs: [], // observed rain gauges
  rainObsAt: null,
  rainObsSrc: '',
  traffic: { events: [], eventsAt: null, roads: [], roadsFresh: null, roadsTotal: null, roadsAt: null, cameras: [], dds: null, longdo: null },
  windyCams: null, // Windy.com webcams (timelapse players)
  mcams: null, // still-image cameras collected by cctv.maholan.net (catalogue)
  mcamAi: null, // that source's AI flood flags (file with generatedAt + flags)
  ytLive: null, // live YouTube camera-like streams in Thailand (unverified)
  satFlood: null, // GISTDA radar-satellite flood extent (cells + province totals)
  news: null, // flood headlines from Thai outlets' RSS (headline + link only)
  floodHistory: null, // repeat-flood-spot grid (Traffy history) — see src/lib/flood-history.js
  dams: null, // key dams feeding the Chao Phraya (RID open API snapshot)
  floods: [], // Traffy Fondue flood complaints (classified)
  floodsAt: null,
  floodsSrc: '',
  floodsError: null,
  reports: [], // active only
  selected: null, // { lat, lng }
  forecast: null, // evaluate() result for selected, or { loading } / { error }
  saved: loadSaved(), // [{ id, label, lat, lng }]
  savedEval: {}, // id -> evaluate() result
  overview: null, // evaluate() result for Bangkok centre
  tab: 'overview',
  accuracy: null, // accuracy.json or null
  push: null, // { ok, reason?, permission, enabled, busy?, error? }
  search: null, // { q, status: 'loading'|'done', floods, stations, reports, places }
  district: '', // district filter in the flood-points tab
  floodLimit: 40,
};

export function savePlaces() {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(state.saved));
  } catch {
    /* storage unavailable */
  }
}

const subs = new Set();
export const onChange = (fn) => subs.add(fn);
export const emit = () => subs.forEach((f) => f());
