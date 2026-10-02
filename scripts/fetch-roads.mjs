// Flood depth on Bangkok roads from Floodboard's open data (CC BY 4.0) → public/data/road-flood.json (compact: only the segments that have water now).
// One request per run (their export is cached for 30 s on their side); if it fails the workflow keeps the live copy.
import { mkdir, writeFile } from 'node:fs/promises';
import { ROADS_URL, ROADS_CREDIT, normalizeRoads, roadNames } from '../src/lib/road-flood.js';

const UA = 'BKKFLOOD/1.0 (+https://bkkflood.web.app; aggasit.j@gmail.com)';
const res = await fetch(ROADS_URL, { headers: { 'user-agent': UA, accept: 'application/geo+json' }, signal: AbortSignal.timeout(60000) });
if (!res.ok) throw new Error(`Floodboard roads HTTP ${res.status}`);
const raw = await res.json();
const now = Date.now();
const features = normalizeRoads(raw, now);
if (!Array.isArray(raw?.features) || raw.features.length < 500) throw new Error(`only ${raw?.features?.length} road segments in the export — refusing to overwrite the snapshot`);

await mkdir('public/data', { recursive: true });
await writeFile(
  'public/data/road-flood.json',
  JSON.stringify({
    generatedAt: now,
    source: `${ROADS_CREDIT.name} (${ROADS_CREDIT.url}) — ${ROADS_CREDIT.licence}`,
    note: 'Changed from the original: only segments with water or a closure are kept, keys shortened, coordinates rounded to 5 decimals.',
    total: raw.features.length,
    names: roadNames(raw),
    features,
  }),
);
console.log(`roads: ${features.length} flooded/closed segments of ${raw.features.length}`);
