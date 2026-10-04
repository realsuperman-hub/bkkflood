// Hourly sea level over the Gulf of Thailand (Open-Meteo Marine, CC BY 4.0, no key) → public/data/tide.json: yesterday + the next 3 days, one value per hour, in cm.
// 195 grid points are requested in chunks, only the ones that are sea are kept. The forecast moves slowly, so a live copy younger than 170 min is reused (the workflow
// runs every 15 min). If the fetch fails the workflow keeps the live copy.
import { mkdir, writeFile } from 'node:fs/promises';
import { gridPoints } from '../src/lib/windfield.js';
import { TIDE_SPEC } from '../src/lib/tidefield.js';

const UA = 'BKKFLOOD/1.0 (+https://bkkflood.web.app; aggasit.j@gmail.com)';
const LIVE = 'https://bkkflood.web.app/data/tide.json';
const MAX_AGE_MS = 170 * 60e3;
const BASE = 'https://marine-api.open-meteo.com/v1/marine';

await mkdir('public/data', { recursive: true });
if (!process.argv.includes('--force')) {
  try {
    const res = await fetch(LIVE, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const text = await res.text();
      const j = JSON.parse(text);
      if (Date.now() - j.generatedAt < MAX_AGE_MS && j.pts?.length) {
        await writeFile('public/data/tide.json', text);
        console.log(`tide: live copy is ${Math.round((Date.now() - j.generatedAt) / 60000)} min old — reused`);
        process.exit(0);
      }
    }
  } catch {
    /* no usable live copy → fetch fresh */
  }
}

const pts = gridPoints(TIDE_SPEC);
const kept = [];
let t0 = null;
let hours = 0;
for (let k = 0; k < pts.length; k += 70) {
  const chunk = pts.slice(k, k + 70);
  const url = `${BASE}?latitude=${chunk.map((p) => p[0]).join(',')}&longitude=${chunk.map((p) => p[1]).join(',')}&hourly=sea_level_height_msl&past_days=1&forecast_days=3&timeformat=unixtime&timezone=GMT`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Open-Meteo Marine HTTP ${res.status}`);
  const j = await res.json();
  const arr = Array.isArray(j) ? j : [j];
  if (arr.length !== chunk.length) throw new Error(`asked for ${chunk.length} points, got ${arr.length}`);
  arr.forEach((x, n) => {
    const time = x.hourly?.time;
    const v = x.hourly?.sea_level_height_msl;
    if (!time?.length || !v) return;
    if (t0 === null) { t0 = time[0] * 1000; hours = time.length; }
    if (time[0] * 1000 !== t0 || v.length !== hours) throw new Error('inconsistent time axis between points');
    if (v.every((m) => m === null || m === undefined)) return; // land
    kept.push({ la: chunk[n][0], ln: chunk[n][1], h: v.map((m) => (m === null || m === undefined ? null : Math.round(m * 100))) });
  });
}
if (kept.length < 30) throw new Error(`only ${kept.length} sea points came back — refusing to overwrite the snapshot`);

await writeFile(
  'public/data/tide.json',
  JSON.stringify({ generatedAt: Date.now(), source: 'Open-Meteo Marine (CC BY 4.0) — ระดับน้ำทะเลจากแบบจำลอง รวมน้ำขึ้นน้ำลงและน้ำหนุนจากลม', t0, hours, pts: kept }),
);
console.log(`tide: ${kept.length} sea points of ${pts.length}, ${hours} hours from ${new Date(t0).toISOString()}`);
