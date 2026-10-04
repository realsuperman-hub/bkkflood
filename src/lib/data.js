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

// BMA traffic (cameras, events, slow road segments) + the Drainage Dept daily report — snapshots produced by the workflow.
const snapshot = async (name) => {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${name} HTTP ${r.status}`);
  return r.json();
};
// Repeat-flood-spot grid built from Traffy's past complaints (scripts/build-flood-history.mjs); optional — the app works without it.
export const loadFloodHistory = () => snapshot('flood-history');
export const loadNews = () => snapshot('news');
// Live Thai camera-like YouTube streams (official API, built by scripts/fetch-youtube-live.mjs); optional
export const loadYtLive = () => snapshot('youtube-live');
// Windy webcams in Thailand (metadata + timelapse player links; built by scripts/fetch-windy.mjs); optional
export const loadWindyCams = () => snapshot('windy-cams');
// Still-image cameras from cctv.maholan.net (catalogue only; built by scripts/fetch-maholan.mjs); optional
export const loadMaholanCams = () => snapshot('maholan-cams');
// Estimated flood depth on Bangkok roads from Floodboard's open data (scripts/fetch-roads.mjs); optional
export const loadRoadFlood = () => snapshot('road-flood');
// Measured road/tunnel depth sensors and canal gauges in Bangkok (POPNIX Flood open API → scripts/fetch-popnix.mjs); optional
export const loadPopnix = () => snapshot('popnix');
// Wind field + upper-Gulf sea-current field for the animated layers (Open-Meteo → scripts/fetch-wind.mjs); optional
export const loadWind = () => snapshot('wind');
// The AI flood flags that source's own model puts on a few of those cameras (scripts/sync-maholan-ai.mjs); optional
export const loadMaholanAi = () => snapshot('maholan-ai');
// Radar-satellite flood extent from GISTDA (built on a Thai network by scripts/sync-gistda.mjs); optional
export const loadSatFlood = () => snapshot('gistda-flood');
export async function loadTraffic() {
  const [events, roads, cameras, dds, dams] = await Promise.allSettled([snapshot('traffic-events'), snapshot('traffic-roads'), snapshot('cameras'), snapshot('dds'), snapshot('dams')]);
  const v = (x) => (x.status === 'fulfilled' ? x.value : null);
  return { events: v(events), roads: v(roads), cameras: v(cameras), dds: v(dds), dams: v(dams) };
}

// Longdo Traffic's Bangkok traffic index (public JSON, CORS-enabled). We show the number as-is and link to Longdo for its meaning.
export async function loadLongdoIndex() {
  const r = await fetch('https://traffic.longdo.com/api/json/traffic/index', { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Longdo HTTP ${r.status}`);
  const j = await r.json();
  if (typeof j.index !== 'number') throw new Error('Longdo: unexpected shape');
  return { index: j.index, time: (j.time || 0) * 1000 };
}
