// Alerts for "roads I use": a device follows up to 5 named roads, each with a depth threshold; the notifier (scripts/notify.mjs) reads the road-flood snapshot
// (Floodboard estimate, src/lib/road-flood.js) and sends one push when a followed road reaches its threshold (or is closed). Pure — unit-tested.
import { VERDICT_TH, VEHICLES, confLabel } from './road-flood.js';

export const MAX_ROADS = 5;
export const THRESHOLDS = [10, 20, 30, 50]; // cm choices offered to the user
export const DEFAULT_MIN = 20;
export const MIN_ROAD_GAP_MS = 30 * 60e3; // at most one road push per device per 30 min
export const SNAPSHOT_MAX_AGE_MS = 3 * 3600e3; // an old snapshot never triggers an alert
export const MIN_CONF = 40; // % — a low-confidence estimate alone does not wake anyone (a closure or a depth twice the threshold does)

// Safe as a Firestore map key: djb2 of the name → "r" + base36
export function roadKey(name) {
  let h = 5381;
  for (const ch of String(name)) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
  return `r${h.toString(36)}`;
}

export function sanitizeRoads(roads) {
  if (!Array.isArray(roads)) return [];
  const seen = new Set();
  const out = [];
  for (const r of roads) {
    const name = String(r?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const min = Math.round(Number(r?.min));
    if (!name || seen.has(name) || !Number.isFinite(min)) continue;
    seen.add(name);
    out.push({ name, min: Math.min(150, Math.max(5, min)) });
    if (out.length >= MAX_ROADS) break;
  }
  return out;
}

// the current state of one named road from the snapshot features → { depth, closed, conf, upd, v:[4] } (depth 0 when it has no water now)
export function currentRoad(features, name) {
  const segs = (features || []).filter((f) => f.properties?.n === name);
  if (!segs.length) return { depth: 0, closed: false, conf: 0, upd: 0, v: [0, 0, 0, 0] };
  return {
    depth: Math.max(...segs.map((f) => f.properties.d)),
    closed: segs.some((f) => f.properties.a === 1),
    conf: Math.max(...segs.map((f) => f.properties.c)),
    upd: Math.max(...segs.map((f) => f.properties.u)),
    v: [0, 1, 2, 3].map((i) => Math.max(...segs.map((f) => (f.properties.a ? 3 : f.properties.v?.[i] ?? 1)))),
  };
}

// prev: { on, at } | undefined · cur from currentRoad · returns { notify, suppressed? }
export function decideRoad(prev, cur, { now, min, lastRoadSentAt = 0 }) {
  const p = prev || { on: false, at: 0 };
  const reached = cur.closed || cur.depth >= min;
  if (!reached || p.on) return { notify: false };
  if (!cur.closed && cur.conf < MIN_CONF && cur.depth < min * 2) return { notify: false };
  if (now - lastRoadSentAt < MIN_ROAD_GAP_MS && !cur.closed) return { notify: false, suppressed: true };
  return { notify: true };
}

// `on` stays true while the road is above the threshold; it re-arms (false) once the water has dropped below half of it and the road is open
export function nextRoadState(prev, cur, { notified, suppressed, now, min }) {
  const p = prev || { on: false, at: 0 };
  if (suppressed) return { on: false, at: p.at || 0 };
  if (notified) return { on: true, at: now };
  if (p.on && !cur.closed && cur.depth < Math.max(1, Math.floor(min / 2))) return { on: false, at: p.at || 0 };
  return { on: p.on, at: p.at || 0 };
}

export function buildRoadMessage(name, cur) {
  const closed = cur.closed;
  return {
    title: closed ? `${name}: ปิดการจราจร (น้ำท่วม)` : `${name}: น้ำท่วมราว ${cur.depth} ซม.`,
    body: `${VEHICLES[1]}: ${VERDICT_TH[cur.v[1]]} · ${VEHICLES[0]}: ${VERDICT_TH[cur.v[0]]} · ความเชื่อมั่น ${confLabel(cur.conf)} (ค่าประมาณ ไม่ใช่ค่าวัดทางการ)`.slice(0, 140),
    url: `/?road=${encodeURIComponent(name)}`,
    tag: `road-${roadKey(name)}`,
  };
}
