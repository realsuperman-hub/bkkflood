// One-off probe of GISTDA's open disaster API with OUR key (repo secret GISTDA_API_KEY). Prints only the SHAPE of each answer
// (status, size, keys, a few property values) — never the key, never a full dump. Run from Actions: gistda-probe workflow.
const KEY = process.env.GISTDA_API_KEY;
if (!KEY) {
  console.error('GISTDA_API_KEY is not set (add it as a repository secret first)');
  process.exit(1);
}
// Two API families are listed by GISTDA: the "Features" API from the official manual (auth: header `API-Key`, or `?api_key=`)
// and the gi-service/disasters endpoints from the open-data catalogue. Both are tried.
const ROOT = 'https://api-gateway.gistda.or.th/api/2.0/resources';
const BASE = `${ROOT}/gi-service/v1.1/disasters`;
const METRO_BBOX = '100.2,13.4,101.0,14.2'; // x-min,y-min,x-max,y-max (metro area)
const box = (lng, lat, d = 0.01) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng - d, lat + d], [lng + d, lat + d], [lng + d, lat - d], [lng - d, lat - d]]] },
});
const HOT = { lat: 13.7212, lng: 100.6713 }; // our most repeatedly reported cell (Prawet / Lat Krabang)
const DRY = { lat: 13.7563, lng: 100.5018 }; // central Bangkok

const calls = [
  // [label, base url, query string]
  ['FEATURES flood/1day, metro bbox', `${ROOT}/features/flood/1day`, `bbox=${METRO_BBOX}&limit=1`],
  ['FEATURES flood/7days, metro bbox', `${ROOT}/features/flood/7days`, `bbox=${METRO_BBOX}&limit=1`],
  ['FEATURES flood/30days, Bangkok (pv_idn=10)', `${ROOT}/features/flood/30days`, 'pv_idn=10&limit=1'],
  ['FEATURES flood/7days, Ayutthaya (pv_idn=14)', `${ROOT}/features/flood/7days`, 'pv_idn=14&limit=1'],
  ['FEATURES flood-freq, around hot spot', `${ROOT}/features/flood-freq`, 'bbox=100.63,13.69,100.71,13.75&limit=1'],
  ['recurrence @ hot spot (point)', `${BASE}/flood-recurrence`, `lat=${HOT.lat}&lon=${HOT.lng}`],
  ['recurrence @ central BKK (point)', `${BASE}/flood-recurrence`, `lat=${DRY.lat}&lon=${DRY.lng}`],
  ['recurrence @ hot spot (area)', `${BASE}/flood-recurrence`, `area=${encodeURIComponent(JSON.stringify(box(HOT.lng, HOT.lat)))}`],
  ['extent 1 day @ hot spot (point)', `${BASE}/flood-extent-1day`, `lat=${HOT.lat}&lon=${HOT.lng}`],
  ['extent 1 day @ Ayutthaya (area)', `${BASE}/flood-extent-1day`, `area=${encodeURIComponent(JSON.stringify(box(100.55, 14.35, 0.1)))}`],
  ['extent 7 days @ Ayutthaya (area)', `${BASE}/flood-extent-7days`, `area=${encodeURIComponent(JSON.stringify(box(100.55, 14.35, 0.1)))}`],
];

const short = (v) => (typeof v === 'object' ? JSON.stringify(v).slice(0, 90) : String(v).slice(0, 90));
const ask = async (base, qs) => {
  // header first (keeps the key out of URLs); if the gateway refuses, retry with ?api_key=
  let res = await fetch(`${base}?${qs}`, { headers: { 'API-Key': KEY, accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  let how = 'header';
  if ([401, 403, 407].includes(res.status)) {
    res = await fetch(`${base}?${qs}&api_key=${KEY}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    how = 'query';
  }
  return { res, how };
};
for (const [label, base, qs] of calls) {
  try {
    const { res, how } = await ask(base, qs);
    const text = await res.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    console.log(`\n== ${label}\n   HTTP ${res.status} ${res.headers.get('content-type')} · ${text.length} bytes`);
    if (!j) {
      console.log(`   body: ${text.slice(0, 200).replace(new RegExp(KEY, 'g'), '<KEY>')}`);
      continue;
    }
    console.log(`   top-level keys: ${Object.keys(j).join(', ')}`);
    const feats = j.features || j.data?.features;
    if (Array.isArray(feats)) {
      console.log(`   features: ${feats.length}${j.numberMatched != null ? ` (matched ${j.numberMatched})` : ''}`);
      const p = feats[0]?.properties;
      if (p) console.log(`   first feature: geometry=${feats[0].geometry?.type} props=${Object.entries(p).slice(0, 10).map(([k, v]) => `${k}=${short(v)}`).join(' | ')}`);
    } else {
      console.log(`   sample: ${Object.entries(j).slice(0, 8).map(([k, v]) => `${k}=${short(v)}`).join(' | ')}`);
    }
  } catch (e) {
    console.log(`\n== ${label}\n   error: ${e.message}`);
  }
}
