import { TW_URL, normalizeStations, STALE_MS } from './thaiwater.js';
import { traffyUrl, normalizeFloods, FLOOD_WINDOW_MS } from './traffy.js';
import { RAIN_URL, normalizeRain, RAIN_STALE_MS } from './rain-obs.js';

const SNAPSHOT_MAX_AGE = 30 * 60 * 1000;

// Recompute "stale" for a snapshot that was generated a while ago.
const restale = (stations, now = Date.now()) =>
  stations.map((s) => ({ ...s, stale: s.t === null || now - s.t > STALE_MS }));

// Prefer the small CDN snapshot when fresh; otherwise hit ThaiWater directly; fall back to old snapshot.
export async function loadStations() {
  let snap = null;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/stations.json`, { cache: 'no-cache' });
    if (r.ok) snap = await r.json();
  } catch {
    /* no snapshot */
  }
  if (snap?.stations && Date.now() - snap.generatedAt < SNAPSHOT_MAX_AGE) {
    return { stations: restale(snap.stations), at: snap.generatedAt, source: 'snapshot' };
  }
  try {
    const res = await fetch(TW_URL, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`ThaiWater HTTP ${res.status}`);
    return { stations: normalizeStations(await res.json()), at: Date.now(), source: 'live' };
  } catch (e) {
    if (snap?.stations) return { stations: restale(snap.stations), at: snap.generatedAt, source: 'snapshot-old' };
    throw e;
  }
}

// Flood complaints (BMA Traffy Fondue). Prefer the pre-filtered CDN snapshot (~60 KB gz);
// the raw API is ~2 MB, so it is only a fallback when the snapshot is missing or older than 2 h.
export async function loadFloods() {
  let snap = null;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/floods.json`, { cache: 'no-cache' });
    if (r.ok) snap = await r.json();
  } catch {
    /* no snapshot */
  }
  const age = snap ? Date.now() - snap.generatedAt : Infinity;
  if (snap?.floods && age < 2 * 3600 * 1000) return { floods: prune(snap.floods), at: snap.generatedAt, source: 'snapshot' };
  try {
    const res = await fetch(traffyUrl(), { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`Traffy HTTP ${res.status}`);
    return { floods: normalizeFloods(await res.json()), at: Date.now(), source: 'live' };
  } catch (e) {
    if (snap?.floods) return { floods: prune(snap.floods), at: snap.generatedAt, source: 'snapshot-old' };
    throw e;
  }
}

// A snapshot can be minutes/hours old: drop anything that has since left the 24 h window.
const prune = (floods, now = Date.now()) => floods.filter((f) => now - f.t < FLOOD_WINDOW_MS);

// Observed rain gauges. Snapshot first (~30 KB); the raw ThaiWater response is 4.5 MB for all of Thailand, so it is only a fallback.
const restaleRain = (gauges, now = Date.now()) => gauges.map((g) => ({ ...g, stale: g.t === null || now - g.t > RAIN_STALE_MS }));
export async function loadRainObs() {
  let snap = null;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/rain.json`, { cache: 'no-cache' });
    if (r.ok) snap = await r.json();
  } catch {
    /* no snapshot */
  }
  if (snap?.gauges && Date.now() - snap.generatedAt < 45 * 60 * 1000) return { gauges: restaleRain(snap.gauges), at: snap.generatedAt, source: 'snapshot' };
  try {
    const res = await fetch(RAIN_URL, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`ThaiWater rain HTTP ${res.status}`);
    return { gauges: normalizeRain(await res.json()), at: Date.now(), source: 'live' };
  } catch (e) {
    if (snap?.gauges) return { gauges: restaleRain(snap.gauges), at: snap.generatedAt, source: 'snapshot-old' };
    throw e;
  }
}

// Published accuracy report (may not exist yet).
export async function loadAccuracy() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/accuracy.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`accuracy HTTP ${r.status}`);
  const j = await r.json();
  if (!j || typeof j.samples !== 'number') throw new Error('accuracy: unexpected shape');
  return j;
}
