// "Can I drive this way?": takes a driving route (from the public OSRM demo server, built on OpenStreetMap) and lays it over the road segments that have
// water now (road-flood.js, Floodboard estimate). For the chosen vehicle it reports which roads on the way are flooded, how deep, over how many metres and
// the worst pass/caution/risky/blocked verdict, and ranks alternatives by it. Only roads present in the flood data are known: "nothing found" never means
// "dry". DOM-free.
import { lengthM } from './road-flood.js';
import { roadCurrent } from './popnix.js';

export const OSRM = 'https://router.project-osrm.org/route/v1/driving';
export const osrmUrl = (from, to) =>
  `${OSRM}/${from.lng.toFixed(5)},${from.lat.toFixed(5)};${to.lng.toFixed(5)},${to.lat.toFixed(5)}?overview=full&geometries=geojson&alternatives=3&steps=false`;

export function parseOsrm(json) {
  if (json?.code !== 'Ok' || !Array.isArray(json.routes)) throw new Error(json?.message || json?.code || 'no route');
  return json.routes
    .map((r) => ({ distanceM: Math.round(r.distance), durationS: Math.round(r.duration), coords: (r.geometry?.coordinates || []).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])) }))
    .filter((r) => r.coords.length >= 2);
}

const KX = 111320;
// points every ≤ stepM along a line (lng,lat)
export function densify(line, stepM = 12) {
  const out = [];
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const lat = (((y0 + y1) / 2) * Math.PI) / 180;
    const d = Math.hypot((x1 - x0) * KX * Math.cos(lat), (y1 - y0) * 110540);
    const n = Math.max(1, Math.ceil(d / stepM));
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  out.push(line[line.length - 1]);
  return out;
}

const CELL = 0.0004; // ≈ 44 m
const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
function gridOf(points) {
  const g = new Map();
  for (const p of points) {
    const k = key(p[0], p[1]);
    (g.get(k) || g.set(k, []).get(k)).push(p);
  }
  return g;
}
const nearGrid = (g, x, y, tolM) => {
  const kx = KX * Math.cos((y * Math.PI) / 180);
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const p of g.get(`${cx + i},${cy + j}`) || []) if (Math.hypot((p[0] - x) * kx, (p[1] - y) * 110540) <= tolM) return true;
    }
  }
  return false;
};

// Verdict (0 pass · 1 caution · 2 risky · 3 blocked) from a MEASURED depth in cm, per vehicle (index as VEHICLES: motorbike, sedan, pickup, truck).
// Rule-of-thumb thresholds [caution, risky, blocked] — a guide for a decision, not a guarantee: moving water, potholes and a low exhaust change everything.
export const DEPTH_LIMITS = [[5, 15, 25], [10, 20, 30], [15, 30, 45], [20, 40, 60]];
export const depthVerdict = (cm, veh = 1) => {
  const t = DEPTH_LIMITS[veh] || DEPTH_LIMITS[1];
  return cm >= t[2] ? 3 : cm >= t[1] ? 2 : cm >= t[0] ? 1 : 0;
};

// the verdict of one segment for a vehicle (0 pass … 3 blocked); a closed road blocks everything it is closed to
export function segVerdict(p, veh) {
  if (p.a) return 3;
  if (p.s && veh <= 1) return 3;
  return p.v?.[veh] ?? 1;
}

// → { worst, floodedM, groups:[{ name, maxD, onM, worst, closed }], hits:[feature…] }
export function checkRoute(features, coords, veh = 1, { tolM = 22, minOnM = 60, sensors = null, now = Date.now() } = {}) {
  const pts = densify(coords, 12);
  const grid = gridOf(pts);
  const bb = pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [180, 90, -180, -90]);
  const pad = 0.0006;
  const hits = [];
  const byName = new Map();
  for (const f of features) {
    let near = 0, total = 0, any = false;
    for (const line of f.geometry.coordinates) {
      for (const [x, y] of line) if (x >= bb[0] - pad && x <= bb[2] + pad && y >= bb[1] - pad && y <= bb[3] + pad) { any = true; break; }
      if (any) break;
    }
    if (!any) continue;
    for (const line of f.geometry.coordinates) {
      for (const [x, y] of densify(line, 12)) {
        total++;
        if (nearGrid(grid, x, y, tolM)) near++;
      }
    }
    if (!total || !near) continue;
    const onM = lengthM(f.geometry.coordinates) * (near / total);
    if (onM < minOnM) continue; // a road that only touches the route at a junction
    hits.push(f);
    const p = f.properties;
    const name = p.n || 'ถนน/ซอย (ไม่ระบุชื่อ)';
    const g = byName.get(name) || { name, maxD: 0, onM: 0, worst: 0, closed: false };
    g.maxD = Math.max(g.maxD, p.d);
    g.onM += onM;
    g.worst = Math.max(g.worst, segVerdict(p, veh));
    g.closed = g.closed || !!p.a;
    byName.set(name, g);
  }
  const groups = [...byName.values()].map((g) => ({ ...g, onM: Math.round(g.onM / 10) * 10 })).sort((a, b) => b.worst - a.worst || b.maxD - a.maxD || b.onM - a.onM);
  const sens = sensors ? checkSensors(sensors, grid, veh, now) : { list: [], worst: 0, dry: 0, stale: 0 };
  return { worst: Math.max(groups.reduce((m, g) => Math.max(m, g.worst), 0), sens.worst), floodedM: groups.reduce((s, g) => s + g.onM, 0), groups, hits, sensors: sens };
}

// POPNIX depth sensors sitting on the route (≤ sensorTolM from it): measured, so they count even where the Floodboard estimate has nothing.
// → { list:[{ …sensor, verdict }] flooded/slight ones, deepest first, worst, dry: sensors with a current reading of no water, stale: sensors without a current reading }
export function checkSensors(sensors, grid, veh, now = Date.now(), sensorTolM = 35) {
  const list = [];
  let dry = 0, stale = 0;
  for (const r of sensors) {
    if (!nearGrid(grid, r.ln, r.la, sensorTolM)) continue;
    if (!roadCurrent(r, now)) { stale++; continue; }
    if (r.lv === 'dry') { dry++; continue; }
    list.push({ ...r, verdict: depthVerdict(r.cm, veh) });
  }
  list.sort((a, b) => b.verdict - a.verdict || b.cm - a.cm);
  return { list, worst: list.reduce((m, r) => Math.max(m, r.verdict), 0), dry, stale };
}

// best first: least bad verdict, then least flooded length, then quickest
export function rankRoutes(routes) {
  return routes.map((r, i) => ({ r, i })).sort((a, b) => a.r.check.worst - b.r.check.worst || a.r.check.floodedM - b.r.check.floodedM || a.r.durationS - b.r.durationS).map((x) => x.i);
}

export const ROUTE_SUMMARY = [
  'ไม่พบถนนที่น้ำท่วมตามเส้นทางนี้ จากข้อมูลที่มี',
  'มีช่วงที่ควรระวัง น้ำขังตื้น ขับช้า ๆ',
  'มีช่วงที่เสี่ยง ควรพิจารณาเส้นทางอื่น',
  'มีช่วงที่ผ่านไม่ได้ ควรเลี่ยงเส้นทางนี้',
];

// Hand the trip over to Google Maps for turn-by-turn. Two waypoints near 1/3 and 2/3 of the chosen route (only on trips over ~3 km) make Google follow about
// the same way instead of picking its own — it still snaps them to roads, so the result is "close to", not "identical to", our route.
export function waypointsOf(coords, parts = 3, minTotalM = 3000) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = lengthM([[coords[i - 1], coords[i]]]);
    seg.push(d);
    total += d;
  }
  if (total < minTotalM) return [];
  const out = [];
  let acc = 0;
  let k = 1;
  for (let i = 0; i < seg.length && k < parts; i++) {
    acc += seg[i];
    if (acc >= (total * k) / parts) { out.push(coords[i + 1]); k++; }
  }
  return out;
}

export function gmapsUrl(from, to, coords = []) {
  const p = (x) => `${x.lat.toFixed(5)},${x.lng.toFixed(5)}`;
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', p(from));
  u.searchParams.set('destination', p(to));
  u.searchParams.set('travelmode', 'driving');
  const wp = waypointsOf(coords).map((c) => `${c[1].toFixed(5)},${c[0].toFixed(5)}`);
  if (wp.length) u.searchParams.set('waypoints', wp.join('|'));
  return u.toString();
}
