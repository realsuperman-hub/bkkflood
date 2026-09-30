// BMA traffic snapshots → public/data/{cameras,traffic-events,traffic-roads}.json
// The ArcGIS service is plain HTTP (browsers on our https site would block it), so it is fetched here, server-side.
// It is queried with EXPLICIT field lists and the camera layer (which leaks device credentials) is never touched.
import { mkdir, writeFile } from 'node:fs/promises';
import { BMA_PAGE, ARC, parseCameras, normalizeEvents, normalizeSegments, countFresh, bangkokNow } from '../src/lib/bma-traffic.js';

const UA = 'Mozilla/5.0 (compatible; BKKFLOOD/1.0; +https://bkkflood.web.app)';
const get = async (url, ms = 60000) => {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).host}`);
  return res;
};
const arc = async (layer, params) => {
  const j = await (await get(`${ARC}/${layer}/query?${params}&f=json`)).json();
  if (j.error) throw new Error(`ArcGIS layer ${layer}: ${j.error.message}`);
  return j;
};

await mkdir('public/data', { recursive: true });
const write = (name, key, value, extra = {}) => writeFile(`public/data/${name}.json`, JSON.stringify({ generatedAt: Date.now(), source: 'กทม. — ระบบกล้องโทรทัศน์วงจรปิดและรายงานสภาพการจราจร', [key]: value, ...extra }));
const results = [];

// cameras: from the page's own list
try {
  const cams = parseCameras(await (await get(BMA_PAGE)).text());
  if (cams.length < 100) throw new Error(`only ${cams.length} cameras parsed — page layout may have changed`);
  await write('cameras', 'cameras', cams);
  results.push(`cameras ${cams.length} (${cams.filter((c) => c.flood).length} flood-watch)`);
} catch (e) {
  results.push(`cameras FAILED: ${e.message}`);
}

// events: those whose date range has not ended yet (BMA dates are Bangkok wall-clock; the SQL backend takes 'YYYY-MM-DD' strings)
try {
  const today = new Date(bangkokNow()).toISOString().slice(0, 10);
  const j = await arc(1, `where=${encodeURIComponent(`date_stop >= '${today}'`)}&outFields=event_id,event_type_id,headline,detail,latitude,longitude,date_start,date_stop&returnGeometry=false&resultRecordCount=1000`);
  const events = normalizeEvents(j.features);
  await write('traffic-events', 'events', events);
  results.push(`events ${events.length} active now (${events.filter((e) => e.kind === 'flood').length} flood)`);
} catch (e) {
  results.push(`events FAILED: ${e.message}`);
}

// road-speed segments
try {
  const j = await arc(3, 'where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=2000');
  const roads = normalizeSegments(j.features);
  await write('traffic-roads', 'roads', roads, { totalSegments: j.features?.length ?? 0, freshSegments: countFresh(j.features) });
  results.push(`road segments: ${roads.length} slow, ${countFresh(j.features)} reporting fresh, ${j.features?.length ?? 0} total`);
} catch (e) {
  results.push(`roads FAILED: ${e.message}`);
}

console.log(results.join('\n'));
if (results.every((r) => r.includes('FAILED'))) process.exit(1); // nothing usable → let the workflow reuse the live snapshots
