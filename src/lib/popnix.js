// Measured water in Bangkok from POPNIX Flood's open API (https://flood.pop.in.th/api/): depth sensors on roads and tunnels (api_roads) and canal
// level gauges (api_overview). The underlying readings are the Drainage and Sewerage Department's (BMA). Free to use with attribution; NOT an official
// warning, a reading is valid only at the sensor, and null means "no value" (never 0). Their terms ask for a server-side fetch + cache (300 req/min/IP),
// so scripts/fetch-popnix.mjs does the one fetch per run and the browser reads our snapshot. DOM-free.

export const POPNIX_ROADS_URL = 'https://flood.pop.in.th/api_roads.php';
export const POPNIX_CANALS_URL = 'https://flood.pop.in.th/api_overview.php';
export const POPNIX_CREDIT = {
  text: 'ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)',
  url: 'https://flood.pop.in.th',
};
export const POPNIX_STALE_MS = 45 * 60e3; // the sensor's own newest reading older than this = no current reading

// POPNIX times are Thai wall-clock "YYYY-MM-DD HH:MM:SS" with no zone
export const thaiTimeMs = (s) => {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3] || '00'}+07:00`) : null;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const inBkk = (la, ln) => la > 13.4 && la < 14.2 && ln > 100.2 && ln < 101.0;

// Compact road/tunnel sensors: { c code, n name, d district, la, ln, cm depth cm (null = no value), lv flood|slight|dry|off, k 1 road 2 tunnel, g depth group, t read at (ms), s flooded since (ms) }
export function normalizePopnixRoads(raw) {
  return (raw?.roads || [])
    .filter((r) => r && inBkk(+r.lat, +r.lng))
    .map((r) => ({
      c: String(r.code),
      n: String(r.name || r.road || r.code),
      d: r.district || '',
      la: +r.lat,
      ln: +r.lng,
      cm: num(r.depth),
      lv: ['flood', 'slight', 'dry', 'off'].includes(r.level) ? r.level : 'off',
      k: r.kind === 2 ? 2 : 1,
      g: r.grp === 2 ? 2 : 1,
      t: thaiTimeMs(r.measured_at),
      s: thaiTimeMs(r.since),
    }));
}

// Compact canal gauges: { id, n name, r river, la, ln, wl level m MSL, warn, crit, bank (m MSL), lv crit|warn|ok|unk|none, tr up|down|flat|null, on online, t read at (ms) }
export function normalizePopnixCanals(raw) {
  return (raw?.stations || [])
    .filter((s) => s && inBkk(+s.lat, +s.lng))
    .map((s) => ({
      id: s.id,
      n: String(s.name || ''),
      r: s.river || '',
      la: +s.lat,
      ln: +s.lng,
      wl: num(s.wl),
      warn: num(s.warn),
      crit: num(s.crit),
      bank: num(s.bank),
      lv: ['crit', 'warn', 'ok', 'unk', 'none'].includes(s.level) ? s.level : 'none',
      tr: ['up', 'down', 'flat'].includes(s.trend) ? s.trend : null,
      on: s.online !== false,
      t: thaiTimeMs(s.measured_at),
    }));
}

// a sensor reading is current only if it has a value, is not marked off, and is not older than POPNIX_STALE_MS
export const roadCurrent = (r, now = Date.now()) => r.lv !== 'off' && r.cm !== null && r.t !== null && now - r.t <= POPNIX_STALE_MS;
export const canalCurrent = (c, now = Date.now()) => c.on && c.wl !== null && c.t !== null && now - c.t <= POPNIX_STALE_MS;

// the level a gauge is judged at: only a current reading counts (an offline gauge keeps its last level in the feed, which would look like a live alarm)
export const canalLevel = (c, now = Date.now()) => (canalCurrent(c, now) ? c.lv : 'stale');

// group 2 sensors step in 5 cm and stop at 20, so 20 means "at least 20"
export const depthText = (r) => (r.cm === null ? '—' : r.g === 2 && r.cm >= 20 ? 'อย่างน้อย 20 ซม.' : `${r.cm} ซม.`);

export const ROAD_LEVEL = {
  flood: { label: 'ท่วม (เกิน 10 ซม.)', color: '#d7263d' },
  slight: { label: 'น้ำเริ่มขัง (5–10 ซม.)', color: '#f2c200' },
  dry: { label: 'ไม่มีน้ำ (ไม่เกิน 5 ซม.)', color: '#2e9e5b' },
  stale: { label: 'ไม่มีค่าล่าสุด', color: '#9aa5af' },
};
export const roadLevel = (r, now = Date.now()) => (roadCurrent(r, now) ? r.lv : 'stale');

export const CANAL_LEVEL = {
  crit: { label: 'ถึงระดับวิกฤต', color: '#d7263d' },
  warn: { label: 'เกินระดับเฝ้าระวัง', color: '#f28c28' },
  ok: { label: 'ต่ำกว่าระดับเฝ้าระวัง', color: '#2e9e5b' },
  unk: { label: 'ไม่มีเกณฑ์เทียบ', color: '#5b6876' },
  none: { label: 'ไม่มีค่า', color: '#9aa5af' },
  stale: { label: 'ไม่มีค่าล่าสุด', color: '#9aa5af' },
};

const km = (la1, ln1, la2, ln2) => {
  const dy = (la2 - la1) * 111.2;
  const dx = (ln2 - ln1) * 111.2 * Math.cos((((la1 + la2) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
};
// sensors within maxKm of a point, nearest first: [{ ...item, km }]
export const nearby = (items, lat, lng, maxKm) =>
  items.map((x) => ({ ...x, km: km(lat, lng, x.la, x.ln) })).filter((x) => x.km <= maxKm).sort((a, b) => a.km - b.km);

// numbers for the overview card
export function summarize(roads, canals, now = Date.now()) {
  const cur = roads.filter((r) => roadCurrent(r, now));
  const flooded = cur.filter((r) => r.lv === 'flood').sort((a, b) => b.cm - a.cm);
  const cc = canals.filter((c) => canalCurrent(c, now));
  const over = (c) => c.wl - ((c.lv === 'crit' ? c.crit : c.warn) ?? 0); // metres above the threshold it crossed
  return {
    roads: { total: roads.length, current: cur.length, flooded, slight: cur.filter((r) => r.lv === 'slight').length },
    canals: {
      total: canals.length,
      current: cc.length,
      crit: cc.filter((c) => c.lv === 'crit').length,
      warn: cc.filter((c) => c.lv === 'warn').length,
      worst: cc.filter((c) => c.lv === 'crit' || c.lv === 'warn').sort((a, b) => over(b) - over(a)),
    },
  };
}
