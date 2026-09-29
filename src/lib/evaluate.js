import { state } from '../state.js';
import { nearestStations } from './geo.js';
import { loadRain, loadTide, loadUpstreamTrend } from './forecast.js';
import { assess } from './risk.js';
import { distKm } from './geo.js';

const val = (r) => (r.status === 'fulfilled' ? r.value : null);

// Gather every signal for a point and score it. Partial failures degrade gracefully.
export async function evaluate(lat, lng) {
  const [rainR, tideR, upR] = await Promise.allSettled([loadRain(lat, lng), loadTide(), loadUpstreamTrend()]);
  const rain = val(rainR);
  const tide = val(tideR);
  const upstreamTrend = val(upR);
  const gauges = nearestStations(state.stations, lat, lng);
  const c13 = state.stations.find((s) => s.code === 'C.13');
  const upstream = { q: c13 && !c13.stale ? c13.q : null };
  const errors = [];
  if (!rain) errors.push('พยากรณ์ฝน (Open-Meteo)');
  if (!tide) errors.push('น้ำทะเลหนุน (Open-Meteo)');
  if (!state.stations.length) errors.push('สถานีวัดน้ำ (ThaiWater)');
  // Fresh complaints within 1 km (last 12 h) — an observed signal, unlike the forecast inputs
  const now = Date.now();
  const nearFloods = state.floods.filter((f) => now - f.t < 12 * 3600e3 && distKm(lat, lng, f.lat, f.lng) <= 1);
  const nearby = { heavy: nearFloods.filter((f) => f.lvl === 3).length, medium: nearFloods.filter((f) => f.lvl === 2).length, light: nearFloods.filter((f) => f.lvl === 1).length };
  const metro = state.stations.filter((s) => !s.upstream && !s.stale);
  const regional = { over: metro.filter((s) => s.level === 5).length, total: metro.length };
  const risk = assess({ rain, tide, gauges, upstream, elevation: rain?.elevation, regional, nearby });
  return { lat, lng, rain, tide, upstreamTrend, gauges, upstream, nearFloods, errors, risk, at: Date.now() };
}
