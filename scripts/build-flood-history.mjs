// Builds data-static/flood-history.json: the repeat-flood-spot grid from Traffy Fondue's past complaints.
// Traffy ignores its date filters but honours `offset` (newest first, ~1,300 complaints of every kind per day), so we page
// backwards until we pass --since. That is ~500 requests of ~2 MB, so it is a one-off/occasional job, not part of the 15-min cycle:
//   node scripts/build-flood-history.mjs --since=2025-06-01 --cache=<dir>     (re-run to resume; pages already in <dir> are reused)
// Only flood complaints (kept with their text-based severity) are stored.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TRAFFY_URL, normalizeFloods } from '../src/lib/traffy.js';
import { aggregateHistory, dayIso, dayNo, servedSnapshot } from '../src/lib/flood-history.js';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const since = Date.parse(`${arg('since', '2025-06-01')}T00:00:00+07:00`);
const cache = arg('cache', 'flood-history-cache');
const out = arg('out', 'data-static/flood-history.json');
const stateOut = arg('state', 'data-static/flood-history-state.json');
// --until=YYYY-MM-DD: last COMPLETE day to include (the daily updater continues from the next day)
const untilArg = arg('until', null);
const PAGE = 1000;
const CONC = Number(arg('conc', 2));
const PAUSE_MS = Number(arg('pause', 3000)); // be gentle: deep offsets are expensive for Traffy's database
const failed = [];
const ts = (f) => Date.parse(String(f.properties?.timestamp || '').replace(' ', 'T') + '+07:00');

await mkdir(cache, { recursive: true });

async function page(offset) {
  const file = join(cache, `p${String(offset).padStart(7, '0')}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* not cached yet */
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
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
      await new Promise((r) => setTimeout(r, 10000 * attempt));
    }
  }
  failed.push(offset); // not cached, so a re-run retries it; the walk continues
  return { offset, count: -1, failed: true, oldest: null, floods: [] };
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
    if (r.failed) continue;
    if (!r.count || (r.oldest !== null && r.oldest < since)) done = true;
  }
  offset += CONC * PAGE;
  await new Promise((r) => setTimeout(r, PAUSE_MS));
  if (pages % 30 === 0) console.log(`${pages} pages, oldest so far ${batch.at(-1).oldest ? dayIso(dayNo(batch.at(-1).oldest)) : '?'}`);
}

if (failed.length) console.error(`WARNING: ${failed.length} pages failed and are missing (offsets ${failed.join(', ')}) — re-run to fill the gaps`);
const files = (await readdir(cache)).filter((f) => f.startsWith('p') && f.endsWith('.json'));
const all = [];
for (const f of files) {
  let r;
  try {
    r = JSON.parse(await readFile(join(cache, f), 'utf8'));
  } catch {
    continue; // a page that is still being written by a running download
  }
  for (const fl of r.floods) if (fl.t >= since && (!untilArg || dayNo(fl.t) <= dayNo(Date.parse(`${untilArg}T12:00:00+07:00`)))) all.push(fl);
}
const times = all.map((f) => f.t);
// the full state keeps EVERY cell (also one-day ones) so the daily updater can add days without double counting
const state = {
  from: dayIso(dayNo(Math.min(...times))),
  to: untilArg || dayIso(dayNo(Math.max(...times))),
  complaints: all.length,
  cells: aggregateHistory(all, { minDays: 1 }),
};
await mkdir('data-static', { recursive: true });
await writeFile(stateOut, JSON.stringify(state));
const snap = servedSnapshot(state);
await writeFile(out, JSON.stringify(snap));
console.log(`wrote ${out}: ${all.length} flood complaints ${state.from} → ${state.to}, ${snap.cells.length} repeat cells (≥2 days), ${state.cells.length} cells in the state, top cell ${snap.cells[0]?.[2]} days`);
