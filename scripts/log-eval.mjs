// Logs what the risk model says for a fixed grid of points (see src/lib/accuracy.js) so it can be graded 24 h later.
// Runs in the Actions job. Needs GOOGLE_APPLICATION_CREDENTIALS. Writes ONE small doc per run to Firestore `evals/`
// (no client access by rules). Prunes docs older than KEEP_DAYS (45).
import { readFile } from 'node:fs/promises';
import { evaluatePoint } from '../src/lib/evaluate-core.js';
import { STALE_MS } from '../src/lib/thaiwater.js';
import { RAIN_STALE_MS } from '../src/lib/rain-obs.js';
import { sampleGrid, makeRecord, KEEP_DAYS } from '../src/lib/accuracy.js';

const now = Date.now();
const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));
const stations = (await readJson('public/data/stations.json')).stations.map((s) => ({ ...s, stale: s.t === null || now - s.t > STALE_MS }));
const floods = (await readJson('public/data/floods.json')).floods.filter((f) => now - f.t < 24 * 3600e3);
const rainObs = (await readJson('public/data/rain.json').catch(() => ({ gauges: [] }))).gauges.map((g) => ({ ...g, stale: g.t === null || now - g.t > RAIN_STALE_MS }));
const tideTable = await readJson('public/data/tide-table.json').catch(() => null); // official tide table (data-static copy); null → tide reported missing

const events = (await readJson('public/data/traffic-events.json').catch(() => ({ events: [] }))).events;
const grid = sampleGrid();
const results = [];
const cache = new Map();
for (let i = 0; i < grid.length; i++) {
  const [lat, lng] = grid[i];
  const rainAt = [Math.round(lat * 10) / 10, Math.round(lng * 10) / 10]; // share forecast calls between neighbours
  try {
    const ev = await evaluatePoint(lat, lng, { stations, floods, rainObs, events, now, rainAt, tideTable });
    if (ev.errors.includes('พยากรณ์ฝน (Open-Meteo)') || !ev.tide) continue; // never log a run missing its forecast or tide — it would poison the grading
    results.push({ i, level: ev.risk.level, score: ev.risk.score, fcScore: ev.risk.fcScore, obsScore: ev.risk.score - ev.risk.fcScore, comp: ev.risk.comp });
  } catch (e) {
    console.error(`point ${i}: ${e.message}`);
  }
  cache.set(rainAt.join(','), true);
}
if (results.length < grid.length * 0.8) {
  console.error(`only ${results.length}/${grid.length} points evaluated — not logging`);
  process.exit(1);
}

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: 'bkkflood-d54cc' });
const db = getFirestore();

const rec = makeRecord(now, results);
await db.doc(`evals/${new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`).set(rec);
console.log(`logged ${results.length}/${grid.length} points (${cache.size} forecast cells)`);

const old = await db.collection('evals').where('t', '<', now - KEEP_DAYS * 86400e3).limit(200).get();
if (!old.empty) {
  const b = db.batch();
  old.docs.forEach((d) => b.delete(d.ref));
  await b.commit();
  console.log(`pruned ${old.size} old logs`);
}
