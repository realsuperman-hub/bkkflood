// Measured road/tunnel flood depth and canal levels in Bangkok from POPNIX Flood's open API → public/data/popnix.json.
// POPNIX asks apps to fetch on the server and cache (their data changes every 5–10 min), so this is the ONLY place that calls them: one request each per run.
// If either call fails the workflow keeps the live copy; a half-empty answer never overwrites a good snapshot.
import { mkdir, writeFile } from 'node:fs/promises';
import { POPNIX_ROADS_URL, POPNIX_CANALS_URL, POPNIX_CREDIT, normalizePopnixRoads, normalizePopnixCanals } from '../src/lib/popnix.js';

const UA = 'BKKFLOOD/1.0 (+https://bkkflood.web.app; aggasit.j@gmail.com)';
const get = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`POPNIX ${new URL(url).pathname} HTTP ${res.status}`);
  return res.json();
};

const [rawRoads, rawCanals] = await Promise.all([get(POPNIX_ROADS_URL), get(POPNIX_CANALS_URL)]);
const roads = normalizePopnixRoads(rawRoads);
const canals = normalizePopnixCanals(rawCanals);
if (roads.length < 50 || canals.length < 50) throw new Error(`POPNIX returned only ${roads.length} road sensors / ${canals.length} canal gauges — refusing to overwrite the snapshot`);

await mkdir('public/data', { recursive: true });
await writeFile(
  'public/data/popnix.json',
  JSON.stringify({
    generatedAt: Date.now(),
    source: POPNIX_CREDIT.text,
    // their own bookkeeping: when their copy was made, and whether their upstream (BMA) scrape is failing
    upstream: { roads: rawRoads.summary?.latest ?? null, roadsFailing: !!rawRoads.summary?.scrape_failing, canals: rawCanals.summary?.latest ?? null, canalsFailing: !!rawCanals.summary?.scrape_failing },
    roads,
    canals,
  }),
);
console.log(`popnix: ${roads.length} road sensors (${roads.filter((r) => r.lv === 'flood').length} flooded), ${canals.length} canal gauges (${canals.filter((c) => c.on && c.lv === 'crit').length} critical)`);
