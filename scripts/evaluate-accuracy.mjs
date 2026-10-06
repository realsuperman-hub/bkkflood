// Grades logged forecasts against Traffy flood complaints and writes public/data/accuracy.json.
// Runs every ~6 h in the Actions job (reads ≤ ~4,400 Firestore docs = 45 days of logs, ~18k reads/day of the free 50k). Needs GOOGLE_APPLICATION_CREDENTIALS.
import { mkdir, writeFile } from 'node:fs/promises';
import { traffyDayUrl, normalizeFloods } from '../src/lib/traffy.js';
import { sampleGrid, buildReport, KEEP_DAYS } from '../src/lib/accuracy.js';

const now = Date.now();
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: 'bkkflood-d54cc' });
const db = getFirestore();

const snap = await db.collection('evals').where('t', '>=', now - KEEP_DAYS * 86400e3).orderBy('t').get();
const records = snap.docs.map((d) => d.data());
console.log(`forecast logs: ${records.length}`);

const day = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10); // Bangkok calendar day
const from = records.length ? records[0].t - 24 * 3600e3 : now - 24 * 3600e3;
const complaints = [];
for (let t = from; t <= now + 86400e3 / 2; t += 86400e3) {
  const res = await fetch(traffyDayUrl(day(t)), { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Traffy ${day(t)} HTTP ${res.status}`);
  complaints.push(...normalizeFloods(await res.json(), now, { history: true }));
}
const uniq = [...new Map(complaints.map((c) => [c.id, c])).values()];
console.log(`flood complaints for grading: ${uniq.length}`);

const report = buildReport(records, uniq, sampleGrid(), now);
await mkdir('public/data', { recursive: true });
await writeFile('public/data/accuracy.json', JSON.stringify(report));
console.log(`report: ${report.samples} graded samples, ${report.events} events, ready=${report.ready}`);
