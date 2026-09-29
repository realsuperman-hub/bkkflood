// Adapter for ThaiWater (สสน./HII) public water-level endpoint.
// Shared by the browser app and scripts/fetch-stations.mjs, so keep it free of DOM APIs.
// NOTE: this is the endpoint thaiwater.net itself uses, not a documented public API —
// the shape can change, so every field is parsed defensively.

export const TW_URL = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load';

// กรุงเทพฯ + ปริมณฑล
const METRO = new Set([
  'กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ', 'สมุทรสาคร', 'นครปฐม',
]);

// Chao Phraya main-stem stations used as the "น้ำเหนือ" indicator (they report discharge, m³/s).
export const UPSTREAM_CODES = ['C.2', 'C.3', 'C.7A', 'C.13', 'C.35'];

// Same 5 classes ThaiWater uses (share of bank capacity: >100% = over the bank).
export const LEVELS = {
  5: { label: 'ล้นตลิ่ง', color: '#d7263d' },
  4: { label: 'น้ำมาก', color: '#f28c28' },
  3: { label: 'ปกติ', color: '#2e9e5b' },
  2: { label: 'น้ำน้อย', color: '#d9b300' },
  1: { label: 'น้ำน้อยวิกฤต', color: '#8c5a2b' },
  0: { label: 'ไม่มีข้อมูล', color: '#8a94a3' },
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// "2026-09-29 21:20" is Bangkok local time.
const parseTime = (s) => {
  if (!s) return null;
  const t = Date.parse(String(s).replace(' ', 'T') + ':00+07:00');
  return Number.isNaN(t) ? null : t;
};

export const STALE_MS = 3 * 3600 * 1000;

export function normalizeStations(raw, now = Date.now()) {
  const rows = raw?.waterlevel_data?.data;
  if (!Array.isArray(rows)) throw new Error('ThaiWater: unexpected response shape');

  const out = [];
  for (const r of rows) {
    const s = r.station || {};
    const code = (s.tele_station_oldcode || '').trim();
    const prov = r.geocode?.province_name?.th || '';
    const upstream = UPSTREAM_CODES.includes(code);
    if (!upstream && !METRO.has(prov)) continue;

    const lat = num(s.tele_station_lat);
    const lng = num(s.tele_station_long);
    if (lat === null || lng === null) continue;

    const msl = num(r.waterlevel_msl);
    const prev = num(r.waterlevel_msl_previous);
    const bank = num(s.min_bank);
    const t = parseTime(r.waterlevel_datetime);
    const level = [1, 2, 3, 4, 5].includes(r.situation_level) ? r.situation_level : 0;

    out.push({
      id: r.station?.id ?? r.id,
      code,
      name: (s.tele_station_name?.th || '').trim(),
      prov,
      lat,
      lng,
      level,
      msl,
      // metres above (+) / below (-) the lower bank; null when either value is missing
      over: msl !== null && bank !== null ? +(msl - bank).toFixed(2) : null,
      trend: msl !== null && prev !== null ? +(msl - prev).toFixed(2) : null,
      q: num(r.discharge),
      t,
      stale: t === null || now - t > STALE_MS,
      upstream,
      agency: r.agency?.agency_shortname?.th?.trim() || '',
    });
  }
  return out;
}

export const trendOf = (st) => {
  if (st.trend === null) return 'unknown';
  if (st.trend > 0.02) return 'rising';
  if (st.trend < -0.02) return 'falling';
  return 'steady';
};

export const TREND_TH = { rising: 'กำลังขึ้น', falling: 'กำลังลด', steady: 'ทรงตัว', unknown: '—' };
