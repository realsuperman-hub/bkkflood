// Evidence gathering for a possible radar "rain in the next hour" feature — NOT part of the app.
// RainViewer's free tiles are colour-mapped images (zoom ≤ 7, ~1.2 km per pixel) with no raw dBZ, and on 2026-09-30 they showed
// echo at 42 of 50 metro gauges that reported 0 mm, so we cannot yet tell how well "echo" means "rain". This job records, for every
// fresh metro rain gauge, its observed 1-hour rain next to the radar pixel (RGBA) at that spot for the last 6 frames (60 min), so that
// after a few rainy days we can measure it instead of guessing. One small Firestore doc per run (radarlog/), pruned after 30 days.
//   node scripts/log-radar.mjs --dry     print a summary, write nothing (no credentials needed)
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const dry = process.argv.includes('--dry');
const Z = 7;
const N = 256 * 2 ** Z;
const FRAMES = 6;
const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));

const tileXY = (lat, lng) => {
  const x = ((lng + 180) / 360) * N;
  const y = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * N;
  return { tx: Math.floor(x / 256), ty: Math.floor(y / 256), px: Math.min(255, Math.floor(x % 256)), py: Math.min(255, Math.floor(y % 256)) };
};

const gaugesFile = await readJson('public/data/rain.json');
const now = Date.now();
const gauges = gaugesFile.gauges.filter((g) => !g.stale && g.r1 !== null && g.r1 !== undefined && g.lat > 13.4 && g.lat < 14.2 && g.lng > 100.2 && g.lng < 101.0 && now - g.t < 90 * 60e3);
if (gauges.length < 10) {
  console.log(`only ${gauges.length} fresh metro gauges — nothing logged`);
  process.exit(0);
}

const maps = await (await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(20000) })).json();
const frames = maps.radar.past.slice(-FRAMES);
if (frames.length < FRAMES) throw new Error(`only ${frames.length} radar frames`);

const cache = new Map();
async function tile(f, tx, ty) {
  const key = `${f.time}/${tx}/${ty}`;
  if (cache.has(key)) return cache.get(key);
  const url = `${maps.host}${f.path}/256/${Z}/${tx}/${ty}/2/0_0.png`;
  let out = null;
  for (let a = 1; a <= 3 && !out; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== 256 || info.height !== 256 || info.channels !== 4) throw new Error('unexpected tile shape');
      out = data;
    } catch (e) {
      if (a === 3) throw new Error(`tile ${key}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * a));
    }
  }
  cache.set(key, out);
  return out;
}

// flat numbers only (Firestore rejects nested arrays): per gauge → r1 × 10, then R,G,B,A for each of the 6 frames (oldest first)
const STRIDE = 1 + FRAMES * 4;
const ids = [];
const flat = [];
for (const g of gauges) {
  const { tx, ty, px, py } = tileXY(g.lat, g.lng);
  ids.push(String(g.id));
  flat.push(Math.round((g.r1 ?? 0) * 10));
  for (const f of frames) {
    const d = await tile(f, tx, ty);
    const i = (py * 256 + px) * 4;
    flat.push(d[i], d[i + 1], d[i + 2], d[i + 3]);
  }
}
const rec = { t: now, frames: frames.map((f) => f.time), stride: STRIDE, ids, v: flat };

const echo = gauges.filter((_, k) => flat.slice(k * STRIDE + 1, (k + 1) * STRIDE).some((v, j) => j % 4 === 3 && v > 0)).length;
const wet = gauges.filter((g) => g.r1 >= 1).length;
console.log(`radar log: ${gauges.length} gauges (${wet} with ≥1 mm in the last hour), echo at ${echo}, ${cache.size} tiles, ${JSON.stringify(rec).length} bytes`);
if (dry) process.exit(0);

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: 'bkkflood-d54cc' });
const db = getFirestore();
await db.doc(`radarlog/${new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`).set(rec);
const old = await db.collection('radarlog').where('t', '<', now - 30 * 86400e3).limit(200).get();
if (!old.empty) {
  const b = db.batch();
  old.docs.forEach((d) => b.delete(d.ref));
  await b.commit();
}
console.log('logged');
