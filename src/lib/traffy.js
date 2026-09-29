// Adapter for Traffy Fondue (BMA citizen-complaint platform) public GeoJSON API — "น้ำท่วม" complaints.
// Shared by the browser app and scripts/fetch-floods.mjs, so keep it free of DOM APIs.
// These are COMPLAINTS, not sensor readings: severity below is inferred from the complaint text
// (+ how many neighbours complained), and the UI labels it as such.
import { distKm, inBounds } from './geo.js';

export const TRAFFY_URL = 'https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1';
export const FLOOD_WINDOW_MS = 24 * 3600 * 1000;

export const SEVERITY = {
  3: { label: 'ท่วมหนัก', color: '#d7263d', short: 'หนัก' },
  2: { label: 'ท่วมปานกลาง', color: '#f28c28', short: 'ปานกลาง' },
  1: { label: 'ท่วมขัง/เล็กน้อย', color: '#f2c200', short: 'เล็กน้อย' },
};

// Explicit depth wording wins over vague wording ("ท่วมสูง... ประมาณเข่า" is knee-deep, not heavy).
const DEPTH_WORDS = [
  [/เอว|หน้าอก|ระดับอก/, 3],
  [/หัวเข่า|เข่า|น่อง/, 2],
  [/ข้อเท้า|หน้าแข้ง/, 1],
];
// Impassable / inside the house → heavy whatever else is said.
const STRONG = /ท่วมมิด|รถดับ|รถเสีย|สัญจรไม่ได้|ผ่านไม่ได้|เข้า[\s-]?ออก(?:ไม่ได้|ไม่ไหว)|น้ำ(?:ไหล)?เข้าบ้าน|เข้าท่วมบ้าน|ท่วมบ้าน/;
const VAGUE_HEAVY = /ท่วมสูง|ท่วมหนัก|หนักมาก/;
const MEDIUM = /รถเล็ก|มอเตอร์ไซค์|ระดับสูง|ไม่ลด|ยังไม่ลด|หลายวัน|\d+\s*วัน|ท่วมขังมา|เข้า[\s-]?ออกยาก/;
// People asking for relief are flagged separately (help) and floored at "medium":
// a relief request says someone is in trouble, not that the road itself is deep.
const HELP = /ติดอยู่|อพยพ|ช่วยเหลือ|ถุงยังชีพ|ผู้ป่วย|ผู้สูงอายุ|คนสูงอายุ|เด็กเล็ก|ต้องการเรือ|ขอเรือ|ไม่มีอาหาร|ของกิน(?:หมด|เริ่มหมด)/;
const RECEDING = /(?:เริ่ม)?ลดลงแล้ว|น้ำลดแล้ว|ลดแล้ว/;
const NOT_RECEDING = /ไม่ลด|ยังไม่ลด|ไม่ลดลง/;

// Returns { lvl: 1..3, depth: cm|null, help: boolean }
export function classify(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  let lvl = 1;
  let depth = null;

  // "50-70 ซม." → take the upper bound
  for (const m of t.matchAll(/(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*(?:ซม|เซน|cm)/gi)) {
    const cm = Math.max(+m[1], +(m[2] || 0));
    if (cm >= 5 && cm <= 200) depth = Math.max(depth ?? 0, cm);
  }
  if (depth !== null) lvl = depth >= 50 ? 3 : depth >= 25 ? 2 : 1;

  let word = 0;
  for (const [re, l] of DEPTH_WORDS) if (re.test(t)) word = Math.max(word, l);
  if (word) lvl = Math.max(lvl, word);

  if (STRONG.test(t)) lvl = 3;
  else if (!word && depth === null && VAGUE_HEAVY.test(t)) lvl = 3;
  else if (MEDIUM.test(t)) lvl = Math.max(lvl, 2);

  const help = HELP.test(t);
  if (help) lvl = Math.max(lvl, 2);

  // "น้ำลดแล้ว" lowers the level by one unless the same text says it hasn't receded
  if (RECEDING.test(t) && !NOT_RECEDING.test(t)) lvl = Math.max(1, lvl - 1);
  return { lvl, depth, help };
}

const parseTs = (s) => {
  if (!s) return null;
  const v = Date.parse(String(s).replace(' ', 'T') + '+07:00');
  return Number.isNaN(v) ? null : v;
};
const first = (v) => (Array.isArray(v) ? v[0] : v);
const isFlood = (v) => (Array.isArray(v) ? v : [v]).some((x) => String(x).includes('น้ำท่วม'));

export function normalizeFloods(raw, now = Date.now()) {
  const feats = raw?.features;
  if (!Array.isArray(feats)) throw new Error('Traffy: unexpected response shape');

  const out = [];
  for (const f of feats) {
    const p = f.properties || {};
    const c = f.geometry?.coordinates;
    if (!c || !isFlood(p.problem_type_fondue)) continue;
    if (['finish', 'irrelevant'].includes(p.state_type_latest)) continue; // resolved / not a real report
    const [lng, lat] = c;
    if (!inBounds(lat, lng)) continue;
    const t = parseTs(p.timestamp);
    const act = parseTs(p.last_activity) ?? t;
    if (t === null || now - Math.max(t, act) > FLOOD_WINDOW_MS) continue;

    const text = String(p.description || '').replace(/\s+/g, ' ').trim();
    const { lvl, depth, help } = classify(text);
    const photo = typeof p.photo_url === 'string' && p.photo_url.startsWith('http') ? p.photo_url : null;
    out.push({
      id: p.ticket_id || p.message_id || `${lat},${lng},${t}`,
      lat, lng, t, lvl, depth, help,
      text: text.slice(0, 160),
      district: first(p.district) || '',
      state: p.state || '',
      photo,
    });
  }

  // Neighbourhood signal: 3+ complaints within 300 m during the last 6 h → one level up (max 3)
  const recent = out.filter((r) => now - r.t < 6 * 3600 * 1000);
  for (const r of out) {
    let n = 0;
    for (const o of recent) if (o !== r && Math.abs(o.lat - r.lat) < 0.004 && distKm(r.lat, r.lng, o.lat, o.lng) <= 0.3) n++;
    r.near = n;
    if (n >= 3 && r.lvl < 3) r.lvl += 1;
  }
  return out.sort((a, b) => b.lvl - a.lvl || b.t - a.t);
}

// Traffy ignores its own filter params, so we request a date window and filter locally.
export function traffyUrl(now = Date.now()) {
  const day = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
  return `${TRAFFY_URL}?limit=1500&start_date=${day(now - FLOOD_WINDOW_MS)}&end_date=${day(now)}`;
}
