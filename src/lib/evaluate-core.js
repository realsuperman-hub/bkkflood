// Point evaluation with NO browser state, shared by the web app (evaluate.js) and the server-side notifier (scripts/notify.mjs).
import { nearestStations, distKm, inCore } from './geo.js';
import { loadRain, loadUpstreamTrend } from './forecast.js';
import { summarizeTideTable } from './tide-table.js';
import { assess } from './risk.js';
import { nearestRain, observedAround } from './rain-obs.js';

const val = (r) => (r.status === 'fulfilled' ? r.value : null);

// ctx: { stations, floods, now?, rainAt?, tideTable? }  — rainAt=[lat,lng] lets the notifier share forecast calls between nearby places;
// tideTable is the official tide table (data/tide-table.json) — the caller loads it, so this file stays free of browser/Node file access.
export async function evaluatePoint(lat, lng, { stations, floods, rainObs = [], events = [], now = Date.now(), rainAt, tideTable = null } = {}) {
  const [rlat, rlng] = rainAt || [lat, lng];
  const [rainR, upR] = await Promise.allSettled([loadRain(rlat, rlng), loadUpstreamTrend()]);
  const rain = val(rainR);
  const tide = summarizeTideTable(tideTable, now);
  const upstreamTrend = val(upR);
  const gauges = nearestStations(stations, lat, lng);
  const c13 = stations.find((s) => s.code === 'C.13');
  const core = inCore(lat, lng);
  // the Chao Phraya dam discharge only matters for Bangkok and its neighbours, not for the eastern provinces
  const upstream = { q: core && c13 && !c13.stale ? c13.q : null };

  // Fresh complaints within 1 km (last 12 h) — an observed signal, unlike the forecast inputs
  const nearFloods = floods.filter((f) => now - f.t < 12 * 3600e3 && distKm(lat, lng, f.lat, f.lng) <= 1);
  const nearby = {
    heavy: nearFloods.filter((f) => f.lvl === 3).length,
    medium: nearFloods.filter((f) => f.lvl === 2).length,
    light: nearFloods.filter((f) => f.lvl === 1).length,
  };
  // region-wide gauge signal: all gauges in the core area; for a point outside it, only the gauges within 60 km of that point
  const metro = stations.filter((s) => !s.upstream && !s.stale && (core || distKm(lat, lng, s.lat, s.lng) <= 60));
  const regional = { over: metro.filter((s) => s.level === 5).length, total: metro.length, area: core ? undefined : 'ภายใน 60 กม.จากจุดนี้' };

  const official = events.filter((e) => e.kind === 'flood' && now - e.t < 12 * 3600e3 && distKm(lat, lng, e.lat, e.lng) <= 1.5);
  const obs = observedAround(rainObs, lat, lng);
  const rainNear = nearestRain(rainObs, lat, lng, { maxKm: 12, limit: 3 });

  const errors = [];
  if (!rain) errors.push('พยากรณ์ฝน (Open-Meteo)');
  if (!tide) errors.push('น้ำทะเลหนุน (ตารางน้ำ กรมอุทกศาสตร์)');
  if (!stations.length) errors.push('สถานีวัดน้ำ (ThaiWater)');

  const risk = assess({ rain, tide, gauges, upstream, elevation: rain?.elevation, regional, nearby, obs, official });
  return { lat, lng, core, rain, tide, upstreamTrend, gauges, upstream, nearFloods, nearby, obs, rainNear, errors, risk, at: Date.now() };
}
