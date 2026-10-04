// Alerts for "roads I use": a device follows up to 5 named roads, each with a depth threshold; the notifier (scripts/notify.mjs) reads the road-flood snapshot
// (Floodboard estimate, src/lib/road-flood.js) and sends one push when a followed road reaches its threshold (or is closed). Pure — unit-tested.
import { VERDICT_TH, VEHICLES, confLabel } from './road-flood.js';
import { sensorsOnRoad, roadCurrent, depthText, POPNIX_CREDIT } from './popnix.js';
import { depthVerdict } from './route-check.js';

export const MAX_ROADS = 5;
export const THRESHOLDS = [10, 20, 30, 50]; // cm choices offered to the user
export const DEFAULT_MIN = 20;
export const MIN_ROAD_GAP_MS = 30 * 60e3; // at most one road push per device per 30 min
export const SNAPSHOT_MAX_AGE_MS = 3 * 3600e3; // an old snapshot never triggers an alert
export const SENSOR_MIN_MS = 10 * 60e3; // a depth sensor must have been above its flood level for this long before it can wake anyone (filters one-off glitches)
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

// the current state of one named road: the Floodboard estimate from the snapshot features, plus the BMA depth sensors on that road (src/lib/popnix.js) when given
// → { depth, closed, conf, upd, v:[4], sensor, sensorUnknown } (depth 0 when it has no water now). A sensor that is current and has been in flood for SENSOR_MIN_MS counts
// as a MEASURED depth: it raises the depth and the verdicts and the reading is trusted (conf 100). A road that has sensors but none with a current reading is "unknown",
// which keeps an alert from re-arming just because the sensor went quiet.
export function currentRoad(features, name, { sensors = null, now = Date.now() } = {}) {
  const segs = (features || []).filter((f) => f.properties?.n === name);
  const est = segs.length
    ? {
        depth: Math.max(...segs.map((f) => f.properties.d)),
        closed: segs.some((f) => f.properties.a === 1),
        conf: Math.max(...segs.map((f) => f.properties.c)),
        upd: Math.max(...segs.map((f) => f.properties.u)),
        v: [0, 1, 2, 3].map((i) => Math.max(...segs.map((f) => (f.properties.a ? 3 : f.properties.v?.[i] ?? 1)))),
      }
    : { depth: 0, closed: false, conf: 0, upd: 0, v: [0, 0, 0, 0] };
  const mine = sensorsOnRoad(sensors, name);
  if (!mine.length) return { ...est, sensor: null, sensorUnknown: false };
  const live = mine.filter((s) => roadCurrent(s, now));
  const flooding = live.filter((s) => s.lv === 'flood' && s.s !== null && now - s.s >= SENSOR_MIN_MS).sort((a, b) => b.cm - a.cm);
  if (!flooding.length) return { ...est, sensor: null, sensorUnknown: live.length === 0 };
  const top = flooding[0];
  return {
    ...est,
    depth: Math.max(est.depth, top.cm),
    conf: 100,
    upd: Math.max(est.upd, top.t),
    v: est.v.map((x, i) => Math.max(x, depthVerdict(top.cm, i))),
    sensor: { n: top.n, cm: top.cm, capped: top.g === 2 && top.cm >= 20, since: top.s, text: depthText(top) },
    sensorUnknown: false,
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
  if (p.on && !cur.closed && !cur.sensorUnknown && cur.depth < Math.max(1, Math.floor(min / 2))) return { on: false, at: p.at || 0 };
  return { on: p.on, at: p.at || 0 };
}

export function buildRoadMessage(name, cur, min = 0) {
  const closed = cur.closed;
  if (cur.sensor && cur.sensor.cm >= min && !closed) {
    // a measured reading reached the threshold: say so, and credit the source (POPNIX asks for it next to the data)
    return {
      title: `${name}: เซ็นเซอร์ กทม. วัดน้ำได้ ${cur.sensor.text}`,
      body: `${VEHICLES[1]}: ${VERDICT_TH[cur.v[1]]} · ${VEHICLES[0]}: ${VERDICT_TH[cur.v[0]]} · วัดที่ ${cur.sensor.n} (ค่าวัดเฉพาะจุดที่ติดตั้ง ไม่ใช่ทั้งสาย${cur.sensor.capped ? ' และเซ็นเซอร์วัดได้สูงสุดเท่านี้ อาจลึกกว่า' : ''}) · ${POPNIX_CREDIT.text}`,
      url: `/?road=${encodeURIComponent(name)}`,
      tag: `road-${roadKey(name)}`,
    };
  }
  return {
    title: closed ? `${name}: ปิดการจราจร (น้ำท่วม)` : `${name}: น้ำท่วมราว ${cur.depth} ซม.`,
    body: `${VEHICLES[1]}: ${VERDICT_TH[cur.v[1]]} · ${VEHICLES[0]}: ${VERDICT_TH[cur.v[0]]} · ความเชื่อมั่น ${confLabel(cur.conf)} (ค่าประมาณ ไม่ใช่ค่าวัดทางการ)`.slice(0, 140),
    url: `/?road=${encodeURIComponent(name)}`,
    tag: `road-${roadKey(name)}`,
  };
}
