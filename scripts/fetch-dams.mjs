// Royal Irrigation Department open API → public/data/dams.json (key dams that feed the Chao Phraya; releases + storage).
// The API publishes one report per day. Early in the day the new one may not exist yet, so walk back until one has data.
import { mkdir, writeFile } from 'node:fs/promises';
import { DAM_API, normalizeDams } from '../src/lib/dams.js';

const bangkokDay = (offset) => new Date(Date.now() + 7 * 3600e3 - offset * 86400e3).toISOString().slice(0, 10);
const day = async (d) => {
  const res = await fetch(`${DAM_API}/${d}`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; BKKFLOOD/1.0; +https://bkkflood.web.app)' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`RID dam API HTTP ${res.status} for ${d}`);
  const j = await res.json().catch(() => null);
  return j && Array.isArray(j.data) && j.data.length ? j : null;
};

let latest = null;
let offset = 0;
for (; offset < 3 && !latest; offset++) latest = await day(bangkokDay(offset));
if (!latest) throw new Error('RID dam API: no report in the last 3 days');
const previous = await day(bangkokDay(offset)); // the day before the latest one found

const snap = normalizeDams(latest, previous);
await mkdir('public/data', { recursive: true });
await writeFile('public/data/dams.json', JSON.stringify({ generatedAt: Date.now(), source: 'กรมชลประทาน (ศูนย์ปฏิบัติการน้ำอัจฉริยะ) — API อ่างเก็บน้ำขนาดใหญ่', ...snap }));
console.log(`wrote dams for ${snap.date}: ${snap.dams.map((d) => `${d.name} ${d.percent}%`).join(', ')}`);
