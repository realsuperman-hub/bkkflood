// Observed rainfall from ThaiWater rain gauges (มูลนิธิ/สสน./กรมชลประทาน/อต. etc.) — what actually fell, unlike the forecast.
// Shared by the browser app and scripts/fetch-rain.mjs, so keep it free of DOM APIs.
import { distKm, BOUNDS } from './geo.js';

export const RAIN_URL = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h';
export const RAIN_STALE_MS = 3 * 3600 * 1000; // a gauge silent for 3 h is not "now"
const MARGIN = 0.15; // keep gauges just outside the service area too — rain there is heading in

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : null; // negative = sensor error code
};
const parseTime = (s) => {
  if (!s) return null;
  const t = Date.parse(String(s).replace(' ', 'T') + ':00+07:00');
  return Number.isNaN(t) ? null : t;
};

export function normalizeRain(raw, now = Date.now()) {
  const rows = raw?.data;
  if (!Array.isArray(rows)) throw new Error('ThaiWater rain: unexpected response shape');
  const out = [];
  for (const r of rows) {
    const s = r.station || {};
    const lat = num(s.tele_station_lat);
    const lng = num(s.tele_station_long);
    if (lat === null || lng === null) continue;
    if (lat < BOUNDS.south - MARGIN || lat > BOUNDS.north + MARGIN || lng < BOUNDS.west - MARGIN || lng > BOUNDS.east + MARGIN) continue;
    const t = parseTime(r.rainfall_datetime);
    const r24 = num(r.rain_24h);
    const r1 = num(r.rain_1h);
    if (r24 === null && r1 === null) continue;
    out.push({
      id: s.id ?? r.id,
      name: (s.tele_station_name?.th || s.tele_station_name?.en || '').trim(),
      prov: r.geocode?.province_name?.th || '',
      agency: r.agency?.agency_shortname?.th?.trim() || '',
      lat, lng, r1, r24, t,
      stale: t === null || now - t > RAIN_STALE_MS,
    });
  }
  return out;
}

export function nearestRain(gauges, lat, lng, { maxKm = 12, limit = 3, fresh = false } = {}) {
  return gauges
    .filter((g) => !fresh || !g.stale)
    .map((g) => ({ ...g, km: distKm(lat, lng, g.lat, g.lng) }))
    .filter((g) => g.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

// hourly intensity (mm in the last hour)
export function intensity1h(mm) {
  if (mm === null || mm === undefined) return { label: '—', color: '#8a94a3' };
  if (mm <= 0) return { label: 'ไม่มีฝน', color: '#8a94a3' };
  if (mm < 2.5) return { label: 'ฝนเล็กน้อย', color: '#4aa3df' };
  if (mm < 10) return { label: 'ฝนปานกลาง', color: '#2f80c8' };
  if (mm < 30) return { label: 'ฝนหนัก', color: '#f28c28' };
  return { label: 'ฝนหนักมาก', color: '#d7263d' };
}

// 24 h accumulation (TMD daily classes)
export function intensity24h(mm) {
  if (mm === null || mm === undefined) return { label: '—', color: '#8a94a3' };
  if (mm < 0.1) return { label: 'ไม่มีฝน', color: '#8a94a3' };
  if (mm <= 10) return { label: 'ฝนเล็กน้อย', color: '#4aa3df' };
  if (mm <= 35) return { label: 'ฝนปานกลาง', color: '#2f80c8' };
  if (mm <= 90) return { label: 'ฝนหนัก', color: '#f28c28' };
  return { label: 'ฝนหนักมาก', color: '#d7263d' };
}

// What matters for flooding right now, from the gauges around a point.
export function observedAround(gauges, lat, lng) {
  const near = nearestRain(gauges, lat, lng, { maxKm: 10, limit: 5, fresh: true });
  if (!near.length) return null;
  const max1 = near.reduce((m, g) => (g.r1 !== null && g.r1 > (m?.r1 ?? -1) ? g : m), null);
  const max24 = near.reduce((m, g) => (g.r24 !== null && g.r24 > (m?.r24 ?? -1) ? g : m), null);
  return { r1: max1?.r1 ?? 0, r1Name: max1?.name || '', r1Km: max1?.km ?? 0, r24: max24?.r24 ?? 0, r24Name: max24?.name || '', r24Km: max24?.km ?? 0, n: near.length };
}
