// Wind (and upper-Gulf sea-current) vector fields for the animated map layers → public/data/wind.json.
// Open-Meteo (CC BY 4.0, no key): one multi-location request per field. The fields change slowly, so a copy younger than 50 minutes is reused instead of
// calling Open-Meteo again (the workflow runs every 15 min) — about 24 fetches × ~160 points a day. If anything fails the workflow keeps the live copy.
import { mkdir, writeFile } from 'node:fs/promises';
import { gridPoints, buildField, validShare } from '../src/lib/windfield.js';

const UA = 'BKKFLOOD/1.0 (+https://bkkflood.web.app; aggasit.j@gmail.com)';
const LIVE = 'https://bkkflood.web.app/data/wind.json';
const MAX_AGE_MS = 50 * 60e3;

await mkdir('public/data', { recursive: true });
if (!process.argv.includes('--force')) {
  try {
    const res = await fetch(LIVE, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const text = await res.text();
      const j = JSON.parse(text);
      if (Date.now() - j.generatedAt < MAX_AGE_MS && j.wind && j.sea) {
        await writeFile('public/data/wind.json', text);
        console.log(`wind: live copy is ${Math.round((Date.now() - j.generatedAt) / 60000)} min old — reused`);
        process.exit(0);
      }
    }
  } catch {
    /* no usable live copy → fetch fresh */
  }
}

// ~0.5° over the Gulf head, Bangkok and the east; the sea grid only covers the upper Gulf (land cells come back null)
const WIND_SPEC = { lat0: 11.5, lng0: 99, step: 0.5, ny: 9, nx: 10 };
const SEA_SPEC = { lat0: 12, lng0: 99.75, step: 0.25, ny: 8, nx: 9 };

async function multi(base, points, current) {
  const lat = points.map((p) => p[0]).join(',');
  const lng = points.map((p) => p[1]).join(',');
  const res = await fetch(`${base}?latitude=${lat}&longitude=${lng}&current=${current}&timezone=Asia%2FBangkok`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`${new URL(base).host} HTTP ${res.status}`);
  const j = await res.json();
  const arr = Array.isArray(j) ? j : [j];
  if (arr.length !== points.length) throw new Error(`${new URL(base).host}: asked for ${points.length} points, got ${arr.length}`);
  return arr.map((x) => x.current || null);
}

const windPts = gridPoints(WIND_SPEC);
const wind = await multi('https://api.open-meteo.com/v1/forecast', windPts, 'wind_speed_10m,wind_direction_10m&wind_speed_unit=ms');
const windField = buildField(WIND_SPEC, wind.map((c) => (c ? { speed: c.wind_speed_10m, deg: c.wind_direction_10m, from: true } : null)));

const seaPts = gridPoints(SEA_SPEC);
const sea = await multi('https://marine-api.open-meteo.com/v1/marine', seaPts, 'ocean_current_velocity,ocean_current_direction');
// km/h → m/s; an oceanographic direction is where the water goes TO
const seaField = buildField(SEA_SPEC, sea.map((c) => (c && c.ocean_current_velocity !== null ? { speed: c.ocean_current_velocity / 3.6, deg: c.ocean_current_direction, from: false } : null)));

if (validShare(windField) < 0.8) throw new Error(`only ${Math.round(validShare(windField) * 100)}% of the wind grid has values — refusing to overwrite the snapshot`);
if (validShare(seaField) < 0.15) throw new Error(`only ${Math.round(validShare(seaField) * 100)}% of the sea grid has values — refusing to overwrite the snapshot`);

await writeFile(
  'public/data/wind.json',
  JSON.stringify({
    generatedAt: Date.now(),
    source: 'Open-Meteo (CC BY 4.0) — ลม: แบบจำลองพยากรณ์อากาศ · กระแสน้ำทะเล: Open-Meteo Marine',
    validAt: wind.find((c) => c)?.time ?? null,
    wind: windField,
    sea: seaField,
  }),
);
console.log(`wind: ${windPts.length} wind points (${Math.round(validShare(windField) * 100)}% valid), ${seaPts.length} sea points (${Math.round(validShare(seaField) * 100)}% valid)`);
