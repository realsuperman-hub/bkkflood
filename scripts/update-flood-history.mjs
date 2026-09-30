// Daily, cheap: adds the newest COMPLETE days of Traffy flood complaints to the repeat-flood-spot history.
// Reads data-static/flood-history-state.json (built once by build-flood-history.mjs), fetches only the newest pages
// (a few thousand complaints ≈ 1–3 days), and rewrites the state + the served snapshot. A no-op when already up to date.
// Days are only ever added once they are over, so a day's cell counts are never split across two runs.
import { readFile, writeFile } from 'node:fs/promises';
import { TRAFFY_URL, normalizeFloods } from '../src/lib/traffy.js';
import { aggregateHistory, dayIso, dayNo, mergeCells, servedSnapshot } from '../src/lib/flood-history.js';

const STATE = process.env.FLOOD_HISTORY_STATE || 'data-static/flood-history-state.json';
const OUT = process.env.FLOOD_HISTORY_OUT || 'data-static/flood-history.json';
const PAGE = 1000;
const MAX_PAGES = 12;
const DAY_MS = 86400e3;

const state = JSON.parse(await readFile(STATE, 'utf8'));
const now = Date.now();
const through = dayNo(now) - 1; // yesterday (Bangkok) is the newest complete day
const toNo = dayNo(Date.parse(`${state.to}T12:00:00+07:00`));
if (toNo >= through) {
  console.log(`flood history already includes ${state.to}`);
  process.exit(0);
}
const startMs = (toNo + 1) * DAY_MS - 7 * 3600e3; // Bangkok midnight that starts the first missing day

const fresh = [];
let coveredBack = false;
for (let p = 0; p < MAX_PAGES && !coveredBack; p++) {
  const res = await fetch(`${TRAFFY_URL}?limit=${PAGE}&offset=${p * PAGE}`, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`Traffy HTTP ${res.status} (offset ${p * PAGE})`);
  const raw = await res.json();
  const feats = raw.features || [];
  const ts = feats.map((f) => Date.parse(String(f.properties?.timestamp || '').replace(' ', 'T') + '+07:00')).filter(Number.isFinite);
  for (const f of normalizeFloods(raw, now, { history: true })) fresh.push({ id: f.id, lat: f.lat, lng: f.lng, t: f.t, lvl: f.lvl });
  if (!feats.length || (ts.length && Math.min(...ts) <= startMs)) coveredBack = true;
}
// Never add a partly-covered stretch: a missing day would look like "no reports", which is wrong.
if (!coveredBack) throw new Error(`pages did not reach back to ${dayIso(toNo + 1)} — not updating`);

const seen = new Set();
const days = fresh.filter((f) => {
  if (seen.has(f.id)) return false;
  seen.add(f.id);
  const d = dayNo(f.t);
  return d > toNo && d <= through;
});
const next = {
  from: state.from,
  to: dayIso(through),
  complaints: state.complaints + days.length,
  cells: mergeCells(state.cells, aggregateHistory(days, { minDays: 1 })),
};
await writeFile(STATE, JSON.stringify(next));
const snap = servedSnapshot(next);
await writeFile(OUT, JSON.stringify(snap));
console.log(`flood history ${state.to} → ${next.to}: +${days.length} complaints, ${snap.cells.length} repeat cells`);
