// BMA (กทม.) traffic data — cameras list, live traffic events, and road-speed segments.
// Source: https://cpudapp.bangkok.go.th/bmatraffic/ and its public ArcGIS service (plain HTTP → must be fetched server-side).
// DOM-free (used by scripts/fetch-traffic.mjs).
//
// SECURITY: the ArcGIS camera layer exposes device admin credentials and internal IPs. This module NEVER requests that layer
// and drops the IP column of the page's camera list. Only whitelisted, public fields leave this file.

export const BMA_PAGE = 'https://cpudapp.bangkok.go.th/bmatraffic/';
export const ARC = 'http://110.170.214.37:6080/arcgis/rest/services/TRAFFIC_CCTV_P2/MapServer';
export const BMA_LINKS = {
  bma: 'https://cpudapp.bangkok.go.th/bmatraffic/',
  itic: 'https://live.iticfoundation.org/',
  longdo: 'https://traffic.longdo.com/main/',
  longdoCameras: 'https://traffic.longdo.com/cameralist', // Longdo's own camera list page (search by camera name/code)
};

// All BMA date fields hold Bangkok wall-clock time stored as if it were UTC.
export const bangkokNow = (now = Date.now()) => now + 7 * 3600e3;
const fromBangkokWall = (ms) => (ms == null ? null : ms - 7 * 3600e3); // → real UTC epoch

/* ───── cameras: parsed from the page's own `locations` array ───── */
export function parseCameras(html) {
  const re = /\[\s*'(\d+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g;
  const out = [];
  for (const m of String(html).matchAll(re)) {
    const lat = +m[6];
    const lng = +m[7];
    if (!(lat > 5 && lat < 21 && lng > 97 && lng < 106)) continue;
    out.push({
      id: m[1],
      name: m[2].replace(/\s+/g, ' ').trim(),
      desc: m[4].replace(/\s+/g, ' ').trim(), // m[8] is the internal IP — deliberately dropped
      lat, lng,
      flood: /flood/i.test(m[9]), // BMA marks flood-watch cameras with a dedicated pin icon
    });
  }
  return out;
}

/* ───── events ───── */
const EVENT_KIND = { 10: 'flood', 7: 'accident', 8: 'fire', 5: 'closed' };
export const EVENT_LABEL = { flood: 'น้ำท่วม', accident: 'อุบัติเหตุ', fire: 'เพลิงไหม้', closed: 'ปิดถนน', other: 'เหตุการณ์' };

// "30/09/2569 07.27 น." (Bangkok, Buddhist year) → real UTC epoch
export function eventTimeFromText(text) {
  const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})\s*น/);
  if (!m) return null;
  return Date.UTC(+m[3] - 543, +m[2] - 1, +m[1], +m[4], +m[5]) - 7 * 3600e3;
}

// BMA's numeric type ids are not consistent (a fire follow-up is filed as type 7), so the headline wins, the id is the fallback.
function kindOf(typeId, headline, text) {
  const h = String(headline || '');
  if (/น้ำท่วม/.test(h)) return 'flood';
  if (/เพลิงไหม้|ไฟไหม้/.test(h)) return 'fire';
  if (/อุบัติเหตุ|รถชน/.test(h)) return 'accident';
  if (/ปิด(?:การจราจร|ถนน)|ถนนปิด/.test(h)) return 'closed';
  return EVENT_KIND[typeId] || (/น้ำท่วม/.test(text) ? 'flood' : 'other');
}

export function normalizeEvents(features, now = Date.now()) {
  const bk = bangkokNow(now);
  const out = [];
  for (const f of features || []) {
    const a = f.attributes || f;
    if (!a.event_id || a.latitude == null || a.longitude == null) continue;
    if (a.date_start != null && a.date_stop != null && !(a.date_start <= bk && bk <= a.date_stop)) continue; // only today's
    const text = `${a.headline || ''} ${a.detail || ''}`;
    out.push({
      id: a.event_id,
      kind: kindOf(a.event_type_id, a.headline, text),
      title: String(a.headline || '').replace(/\s+/g, ' ').trim(),
      detail: String(a.detail || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      lat: a.latitude,
      lng: a.longitude,
      t: eventTimeFromText(a.detail) ?? fromBangkokWall(a.date_start),
    });
  }
  return out.sort((x, y) => (y.kind === 'flood') - (x.kind === 'flood') || y.t - x.t);
}

/* ───── road speed segments ───── */
export const SPEED_LEVEL = {
  1: { label: 'ติดหนักมาก (แทบไม่เคลื่อน)', color: '#8b1d4a' },
  2: { label: 'ติดหนัก', color: '#d7263d' },
  3: { label: 'ติดปานกลาง', color: '#f28c28' },
  4: { label: 'เริ่มหนาแน่น', color: '#e6b800' },
};
const K = 'TRAFFIC.dbo.tbl_data_line_color_lastupdate.';

// Keep only fresh (<2 h), slow (level 1–4) segments — free-flowing roads are the map's default and would only add weight.
export function normalizeSegments(features, now = Date.now()) {
  const bk = bangkokNow(now);
  const out = [];
  for (const f of features || []) {
    const a = f.attributes || {};
    const lv = a[K + 'speed_level'];
    const upd = a[K + 'Last_Update'];
    const speed = a[K + 'Speed'];
    if (![1, 2, 3, 4].includes(lv) || upd == null || bk - upd > 2 * 3600e3 || bk - upd < -3600e3) continue;
    const paths = f.geometry?.paths;
    if (!paths?.length) continue;
    out.push({
      lv,
      sp: speed == null ? null : Math.round(speed),
      t: fromBangkokWall(upd),
      paths: paths.map((p) => p.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)])),
    });
  }
  return out;
}

// How many monitored segments reported within the last 2 h (any speed) — so "no jams" can be told apart from "no data".
export function countFresh(features, now = Date.now()) {
  const bk = bangkokNow(now);
  return (features || []).filter((f) => {
    const upd = f.attributes?.[K + 'Last_Update'];
    return upd != null && bk - upd <= 2 * 3600e3 && bk - upd >= -3600e3;
  }).length;
}
