// Estimated flood depth on Bangkok roads, from Floodboard's open data (https://floodboard.org/api/export/roads.geojson, licence CC BY 4.0, CORS open).
// Floodboard combines BMA road sensors (cm), the BMA drainage report, Traffy Fondue, ThaiWater, CCTV, news and social posts and rates each road segment:
// depth in cm, whether it is closed, and a pass/caution/risky/blocked verdict per vehicle type, with a confidence. We keep only the segments that
// have water now, simplified to a compact snapshot (scripts/fetch-roads.mjs) — changed from the original: filtered, shortened keys, rounded coordinates.
// Always shown as an ESTIMATE with its credit; never part of the risk score. DOM-free.
import { BOUNDS } from './geo.js';

export const ROADS_URL = 'https://floodboard.org/api/export/roads.geojson';
export const ROADS_CREDIT = { name: 'Floodboard', url: 'https://floodboard.org', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' };

export const VERDICT = { ok: 0, caution: 1, risky: 2, blocked: 3 };
export const VERDICT_TH = ['ผ่านได้', 'ระวัง', 'เสี่ยง', 'ผ่านไม่ได้'];
export const VERDICT_COLOR = ['#2e9e5b', '#d9b300', '#f28c28', '#d7263d'];
export const VEHICLES = ['มอเตอร์ไซค์', 'รถเก๋ง', 'รถกระบะ', 'รถบรรทุก']; // index = position in `v`

// colour of the road line on the map, by depth in cm
export const DEPTH_BANDS = [
  { min: 50, color: '#8b1d4a', label: '50 ซม. ขึ้นไป' },
  { min: 30, color: '#d7263d', label: '30–49 ซม.' },
  { min: 15, color: '#f28c28', label: '15–29 ซม.' },
  { min: 1, color: '#e6b800', label: '1–14 ซม.' },
];
export const bandOf = (d) => DEPTH_BANDS.find((b) => d >= b.min) || null;
export const CLOSED_COLOR = '#12222e';

export const confLabel = (c) => (c >= 70 ? 'สูง' : c >= 40 ? 'กลาง' : 'ต่ำ');

// what a depth feels like, for people who think in ankle / knee / waist rather than centimetres
export const depthWord = (d) => (d >= 80 ? 'ระดับเอวขึ้นไป' : d >= 50 ? 'เหนือเข่า' : d >= 30 ? 'ราวเข่า' : d >= 15 ? 'ราวข้อเท้าถึงน่อง' : d >= 1 ? 'ต่ำกว่าข้อเท้า' : '');

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const inBox = (lng, lat) => lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east;

// Floodboard roads.geojson → compact { features:[{ type, geometry:MultiLineString, properties:{ n, d, a, s, c, u, v:[0-3 ×4], h } }] }
// n name · d depth cm · a closed to all · s closed to small cars · c confidence % · u updated ms · v verdicts · h highway class
export function normalizeRoads(raw, now = Date.now()) {
  const feats = raw?.features;
  if (!Array.isArray(feats)) throw new Error('Floodboard: unexpected response shape');
  const out = [];
  for (const f of feats) {
    const p = f?.properties || {};
    const d = Number(p.depthCm) || 0;
    const a = p.closedAll === true;
    const s = p.closedSmall === true;
    if (p.cleared === true || (d <= 0 && !a && !s)) continue;
    const lines = f?.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : f?.geometry?.type === 'LineString' ? [f.geometry.coordinates] : null;
    if (!lines) continue;
    const coords = lines
      .map((l) => l.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && inBox(c[0], c[1])).map((c) => [r5(c[0]), r5(c[1])]))
      .filter((l) => l.length >= 2);
    if (!coords.length) continue;
    const u = Number(p.updated);
    out.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: coords },
      properties: {
        n: String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        d: clamp(Math.round(d), 0, 300),
        a: a ? 1 : 0,
        s: s ? 1 : 0,
        c: clamp(Math.round((Number(p.conf) || 0) * 100), 0, 100),
        u: Number.isFinite(u) && u > 0 && u <= now + 3600e3 ? u : now,
        v: ['motorbike', 'sedan', 'pickup', 'truck'].map((k) => VERDICT[p.verdict?.[k]] ?? 1),
        h: String(p.hw || '').slice(0, 20),
      },
    });
  }
  return out;
}

const KX = 111320;
// length of a MultiLineString in metres (equirectangular, fine at city scale)
export function lengthM(coords) {
  let m = 0;
  for (const line of coords) {
    for (let i = 1; i < line.length; i++) {
      const lat = (((line[i][1] + line[i - 1][1]) / 2) * Math.PI) / 180;
      m += Math.hypot((line[i][0] - line[i - 1][0]) * KX * Math.cos(lat), (line[i][1] - line[i - 1][1]) * 110540);
    }
  }
  return m;
}

// distance in metres from a point to the nearest part of a MultiLineString
export function distToLinesM(coords, lat, lng) {
  const kx = KX * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const line of coords) {
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][0] - lng) * kx, ay = (line[i - 1][1] - lat) * 110540;
      const bx = (line[i][0] - lng) * kx, by = (line[i][1] - lat) * 110540;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? clamp(-(ax * dx + ay * dy) / len2, 0, 1) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

// group the segments of one road: one row per named road
function groupByName(features) {
  const m = new Map();
  for (const f of features) {
    const p = f.properties;
    if (!p.n) continue;
    const g = m.get(p.n) || { name: p.n, segs: 0, maxD: 0, closedAll: 0, closedSmall: 0, meters: 0, conf: 0, upd: 0, v: [0, 0, 0, 0], coords: [] };
    g.segs++;
    g.maxD = Math.max(g.maxD, p.d);
    g.closedAll += p.a;
    g.closedSmall += p.s;
    g.meters += lengthM(f.geometry.coordinates);
    g.conf = Math.max(g.conf, p.c);
    g.upd = Math.max(g.upd, p.u);
    g.v = g.v.map((x, i) => Math.max(x, p.v[i]));
    g.coords.push(...f.geometry.coordinates);
    m.set(p.n, g);
  }
  return [...m.values()];
}

// how urgent a road is: deeper water, closure, more length and a confident, recent reading rank higher
export function urgency(g, now = Date.now()) {
  const ageH = Math.max(0, (now - g.upd) / 3600e3);
  const fresh = ageH <= 2 ? 1 : ageH <= 6 ? 0.8 : 0.5;
  return (g.maxD + (g.closedAll ? 40 : g.closedSmall ? 20 : 0) + Math.min(30, g.meters / 100)) * (0.4 + 0.6 * (g.conf / 100)) * fresh;
}

// one named road's segments gathered (null when it has none now)
export const roadGroup = (features, name) => groupByName(features.filter((f) => f.properties.n === name))[0] || null;

export function summarizeRoads(features, now = Date.now()) {
  const meters = features.reduce((s, f) => s + lengthM(f.geometry.coordinates), 0);
  const maxD = features.reduce((m, f) => Math.max(m, f.properties.d), 0);
  const closed = features.filter((f) => f.properties.a);
  const groups = groupByName(features);
  const top = groups.sort((a, b) => urgency(b, now) - urgency(a, now) || b.meters - a.meters);
  return {
    segments: features.length,
    roads: groups.length,
    km: Math.round(meters / 100) / 10,
    maxD,
    closedKm: Math.round(closed.reduce((s, f) => s + lengthM(f.geometry.coordinates), 0) / 100) / 10,
    deep: features.filter((f) => f.properties.d >= 30).length,
    top,
  };
}

// named roads with water within `maxM` of a point, nearest first
export function nearRoads(features, lat, lng, maxM = 500, now = Date.now()) {
  const near = features.filter((f) => f.properties.n && distToLinesM(f.geometry.coordinates, lat, lng) <= maxM);
  return groupByName(near)
    .map((g) => ({ ...g, m: Math.round(Math.min(...near.filter((f) => f.properties.n === g.name).map((f) => distToLinesM(f.geometry.coordinates, lat, lng)))) }))
    .sort((a, b) => a.m - b.m || urgency(b, now) - urgency(a, now));
}

const loose = (s) => String(s || '').toLowerCase().replace(/[\s.\-ๆ]+/g, '');
// roads whose name contains the query (search box)
export function matchRoads(features, q, limit = 8, now = Date.now()) {
  const nq = loose(q);
  if (nq.length < 2) return [];
  return groupByName(features.filter((f) => loose(f.properties.n).includes(nq)))
    .sort((a, b) => urgency(b, now) - urgency(a, now))
    .slice(0, limit);
}

export const centroid = (coords) => {
  const pts = coords.flat();
  return { lat: pts.reduce((s, c) => s + c[1], 0) / pts.length, lng: pts.reduce((s, c) => s + c[0], 0) / pts.length };
};
