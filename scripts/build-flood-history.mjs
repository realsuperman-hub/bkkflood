// Builds data-static/flood-history.json: the repeat-flood-spot grid from Traffy Fondue's past complaints.
// Traffy ignores its date filters but honours `offset` (newest first, ~1,300 complaints of every kind per day), so we page
// backwards until we pass --since. That is ~500 requests of ~2 MB, so it is a one-off/occasional job, not part of the 15-min cycle:
//   node scripts/build-flood-history.mjs --since=2025-06-01 --cache=<dir>     (re-run to resume; pages already in <dir> are reused)
// Only flood complaints (kept with their text-based severity) are stored.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TRAFFY_URL, normalizeFloods } from '../src/lib/traffy.js';
import { aggregateHistory, CELL, dayIso, dayNo } from '../src/lib/flood-history.js';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const since = Date.parse(`${arg('since', '2025-06-01')}T00:00:00+07:00`);
const cache = arg('cache', 'flood-history-cache');
const out = arg('out', 'data-static/flood-history.json');
const PAGE = 1000;
const CONC = 3;
const ts = (f) => Date.parse(String(f.properties?.timestamp || '').replace(' ', 'T') + '+07:00');

await mkdir(cache, { recursive: true });

async function page(offset) {
  const file = join(cache, `p${String(offset).padStart(7, '0')}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* not cached yet */
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${TRAFFY_URL}?limit=${PAGE}&offset=${offset}`, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const feats = raw.features || [];
      const times = feats.map(ts).filter(Number.isFinite);
      const floods = normalizeFloods(raw, Date.now(), { history: true }).map((f) => ({ id: f.id, lat: f.lat, lng: f.lng, t: f.t, lvl: f.lvl }));
      const rec = { offset, count: feats.length, oldest: times.length ? Math.min(...times) : null, newest: times.length ? Math.max(...times) : null, floods };
      await writeFile(file, JSON.stringify(rec));
      return rec;
    } catch (e) {
      console.error(`offset ${offset} attempt ${attempt}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(`offset ${offset} failed`);
}

// walk backwards in batches of CONC pages until the oldest complaint is older than --since
// (--aggregate-only: skip downloading and summarise whatever pages are already in the cache — an interim snapshot)
const onlyAggregate = process.argv.includes('--aggregate-only');
let offset = 0;
let done = onlyAggregate;
let pages = 0;
while (!done) {
  const batch = await Promise.all(Array.from({ length: CONC }, (_, k) => page(offset + k * PAGE)));
  for (const r of batch) {
    pages += 1;
    if (!r.count || (r.oldest !== null && r.oldest < since)) done = true;
  }
  offset += CONC * PAGE;
  if (pages % 30 === 0) console.log(`${pages} pages, oldest so far ${batch.at(-1).oldest ? dayIso(dayNo(batch.at(-1).oldest)) : '?'}`);
}

const files = (await readdir(cache)).filter((f) => f.startsWith('p') && f.endsWith('.json'));
const all = [];
for (const f of files) {
  let r;
  try {
    r = JSON.parse(await readFile(join(cache, f), 'utf8'));
  } catch {
    continue; // a page that is still being written by a running download
  }
  for (const fl of r.floods) if (fl.t >= since) all.push(fl);
}
const cells = aggregateHistory(all);
const times = all.map((f) => f.t);
const snap = {
  generatedAt: Date.now(),
  source: 'Traffy Fondue (กทม.) — ข้อความแจ้งน้ำท่วมย้อนหลัง',
  from: dayIso(dayNo(Math.min(...times))),
  to: dayIso(dayNo(Math.max(...times))),
  cell: CELL,
  complaints: all.length,
  cells,
};
await mkdir('data-static', { recursive: true });
await writeFile(out, JSON.stringify(snap));
console.log(`wrote ${out}: ${all.length} flood complaints ${snap.from} → ${snap.to}, ${cells.length} repeat cells (≥2 days), top cell ${cells[0]?.[2]} days`);
