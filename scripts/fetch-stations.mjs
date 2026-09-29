// Writes public/data/stations.json — a small, CDN-friendly snapshot of the metro gauges,
// so visitors don't each download ThaiWater's 1.4 MB response.
// Run: npm run data   (schedule it, e.g. via GitHub Actions, then redeploy hosting)
import { mkdir, writeFile } from 'node:fs/promises';
import { TW_URL, normalizeStations } from '../src/lib/thaiwater.js';

const res = await fetch(TW_URL, { signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`ThaiWater HTTP ${res.status}`);
const stations = normalizeStations(await res.json());
if (stations.length < 10) throw new Error(`only ${stations.length} stations — refusing to overwrite snapshot`);

await mkdir('public/data', { recursive: true });
await writeFile(
  'public/data/stations.json',
  JSON.stringify({ generatedAt: Date.now(), source: 'ThaiWater (HII)', stations }),
);
console.log(`wrote ${stations.length} stations`);
