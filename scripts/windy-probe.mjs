// One-off probe of the Windy Webcams API v3 with OUR key (env WINDY_API_KEY, from a repo secret). Prints only counts and the SHAPE of the
// answers (never the key, never a full dump): how many Thai webcams exist, how many are near Bangkok, and which fields/players the free tier returns.
const KEY = process.env.WINDY_API_KEY;
if (!KEY) {
  console.error('WINDY_API_KEY is not set');
  process.exit(1);
}
const BASE = 'https://api.windy.com/webcams/api/v3/webcams';
const get = async (qs) => {
  const res = await fetch(`${BASE}?${qs}`, { headers: { 'x-windy-api-key': KEY, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, j, text };
};

const INCLUDE = 'location,player,urls,images,categories';
let r = await get(`countries=TH&limit=50&offset=0&include=${INCLUDE}`);
console.log(`Thailand list: HTTP ${r.status}`);
if (r.status !== 200) {
  console.log(`body: ${r.text.slice(0, 300).replace(new RegExp(KEY, 'g'), '<KEY>')}`);
  process.exit(0);
}
console.log(`top-level keys: ${Object.keys(r.j).join(', ')} | total ${r.j.total} | first page ${r.j.webcams?.length}`);
const all = [...(r.j.webcams || [])];
for (let off = 50; off < Math.min(r.j.total || 0, 1000); off += 50) {
  const p = await get(`countries=TH&limit=50&offset=${off}&include=${INCLUDE}`);
  if (p.status !== 200) {
    console.log(`page offset ${off}: HTTP ${p.status} ${p.j?.message || ''}`);
    break;
  }
  all.push(...(p.j.webcams || []));
}
console.log(`fetched ${all.length} Thai webcams`);
const near = (w, lat, lng, d) => Math.abs(w.location?.latitude - lat) < d && Math.abs(w.location?.longitude - lng) < d;
const bkk = all.filter((w) => near(w, 13.75, 100.5, 0.35));
console.log(`within ~35 km of central Bangkok: ${bkk.length}; Thai regions: ${[...new Set(all.map((w) => w.location?.region))].slice(0, 12).join(', ')}`);
for (const w of bkk.slice(0, 15)) console.log(`  - ${w.webcamId} | ${w.title?.slice(0, 60)} | ${w.location?.city} | status ${w.status}`);
const w0 = all[0];
if (w0) {
  console.log(`one webcam: keys=${Object.keys(w0).join(',')}`);
  console.log(`  player keys: ${Object.keys(w0.player || {}).join(',')} | urls keys: ${Object.keys(w0.urls || {}).join(',')} | image sizes: ${Object.keys(w0.images?.current || {}).join(',')}`);
  console.log(`  status/lastUpdatedOn: ${w0.status} / ${w0.lastUpdatedOn}`);
}
