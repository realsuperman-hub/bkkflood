// Adapter for ThaiWater (สสน./HII) public water-level endpoint.
// Shared by the browser app and scripts/fetch-stations.mjs, so keep it free of DOM APIs.
// NOTE: this is the endpoint thaiwater.net itself uses, not a documented public API —
// the shape can change, so every field is parsed defensively.

export const TW_URL = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load';

// กรุงเทพฯ + ปริมณฑล
const METRO = new Set([
  'กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ', 'สมุทรสาคร', 'นครปฐม',
  'ฉะเชิงเทรา', 'ชลบุรี', 'ระยอง', // ภาคตะวันออก (added 2026-10-01)
]);
// Upstream of the Bang Pakong river (Chachoengsao): their gauges are shown and listed, but kept out of every local-gauge calculation like the Chao Phraya upstream ones
const BPK_UPSTREAM = new Set(['ปราจีนบุรี', 'นครนายก']);

// Chao Phraya main-stem gauges, north → south (Nakhon Sawan … Bangkok), verified in ThaiWater's feed 2026-09-30.
// C.* stations also report discharge (m³/s). The ones outside the metro provinces are flagged `upstream`, which keeps them out of
// every metro-gauge calculation; the metro ones (CPY014 Nonthaburi, C.12 Sam Sen, CPY015 Bangkok) stay ordinary gauges but are
// also `chain`, so the river card can show the whole route.
export const CHAIN_CODES = [
  'CPY001', 'C.2', 'CPY002', 'CPY003', 'CPY004', 'C.13', 'CPY005', 'CPY006', 'CPY007', 'C.3',
  'CPY008', 'C.7A', 'CPY011', 'C.35', 'CPY012', 'CPY014', 'C.12', 'CPY015',
];

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
    const chain = CHAIN_CODES.includes(code);
    const bpk = !chain && BPK_UPSTREAM.has(prov);
    const upstream = (chain && !METRO.has(prov)) || bpk;
    if (!chain && !METRO.has(prov) && !bpk) continue;

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
      chain,
      basin: bpk ? 'bpk' : undefined,
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
