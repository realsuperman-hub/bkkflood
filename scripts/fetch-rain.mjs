// Writes public/data/rain.json — observed rainfall gauges in/near Bangkok+metro (ThaiWater's raw response is 4.5 MB, all of Thailand).
import { mkdir, writeFile } from 'node:fs/promises';
import { RAIN_URL, normalizeRain } from '../src/lib/rain-obs.js';

const res = await fetch(RAIN_URL, { signal: AbortSignal.timeout(60000) });
if (!res.ok) throw new Error(`ThaiWater rain HTTP ${res.status}`);
const gauges = normalizeRain(await res.json());
if (gauges.length < 10) throw new Error(`only ${gauges.length} rain gauges — refusing to overwrite snapshot`);

await mkdir('public/data', { recursive: true });
await writeFile('public/data/rain.json', JSON.stringify({ generatedAt: Date.now(), source: 'ThaiWater (HII)', gauges }));
const wet = gauges.filter((g) => (g.r1 ?? 0) > 0).length;
console.log(`wrote ${gauges.length} rain gauges (${wet} with rain in the last hour)`);
