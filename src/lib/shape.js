// Geometry helpers for drawn flood reports (road stretches and areas). DOM-free so they can be unit-tested.
import { distKm } from './geo.js';

export const MAX_VERTS = 40;
export const KINDS = { point: 'จุด', line: 'เส้นถนน', area: 'พื้นที่' };
export const MIN_VERTS = { point: 1, line: 2, area: 3 };

// pts: [[lat, lng], ...]
export function lengthM(pts) {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += distKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * 1000;
  return m;
}

// Shoelace on a local equirectangular projection — fine at city scale.
export function areaM2(pts) {
  if (pts.length < 3) return 0;
  const lat0 = (pts.reduce((s, p) => s + p[0], 0) / pts.length) * (Math.PI / 180);
  const kx = 111320 * Math.cos(lat0);
  const ky = 110540;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [y1, x1] = pts[i];
    const [y2, x2] = pts[(i + 1) % pts.length];
    a += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(a) / 2;
}

// The single lat/lng used for the pin, bounds checks and "near me" queries.
export function anchor(kind, pts) {
  if (kind === 'line' && pts.length >= 2) {
    const half = lengthM(pts) / 2;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = distKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) * 1000;
      if (acc + seg >= half && seg > 0) {
        const t = (half - acc) / seg;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      acc += seg;
    }
    return pts[pts.length - 1];
  }
  if (kind === 'area' && pts.length >= 3) {
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  }
  return pts[0];
}

export const flatten = (pts) => pts.flatMap((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]);
export function unflatten(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i + 1 < arr.length; i += 2) out.push([arr[i], arr[i + 1]]);
  return out;
}

// GeoJSON geometry ([lng, lat] order) for map layers
export function toGeometry(kind, pts) {
  const c = pts.map(([lat, lng]) => [lng, lat]);
  if (kind === 'line') return { type: 'LineString', coordinates: c };
  if (kind === 'area') return { type: 'Polygon', coordinates: [[...c, c[0]]] };
  return { type: 'Point', coordinates: c[0] };
}

export function validate(kind, pts, inBounds) {
  if (!MIN_VERTS[kind]) return 'ชนิดไม่ถูกต้อง';
  if (pts.length < MIN_VERTS[kind]) return kind === 'line' ? 'เส้นต้องมีอย่างน้อย 2 จุด' : 'พื้นที่ต้องมีอย่างน้อย 3 จุด';
  if (pts.length > MAX_VERTS) return `วาดได้ไม่เกิน ${MAX_VERTS} จุด`;
  if (!pts.every(([la, ln]) => inBounds(la, ln))) return 'มีจุดที่อยู่นอกพื้นที่บริการ (กทม. ปริมณฑล และภาคตะวันออก)';
  if (kind === 'line' && lengthM(pts) < 5) return 'เส้นสั้นเกินไป';
  if (kind === 'area' && areaM2(pts) < 20) return 'พื้นที่เล็กเกินไป';
  return null;
}

export const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} กม.` : `${Math.round(m)} ม.`);
export const fmtArea = (m2) => (m2 >= 1e6 ? `${(m2 / 1e6).toFixed(2)} ตร.กม.` : `${Math.round(m2).toLocaleString('th-TH')} ตร.ม.`);
export const describe = (kind, pts) => (kind === 'line' ? `ยาว ≈ ${fmtLen(lengthM(pts))}` : kind === 'area' ? `พื้นที่ ≈ ${fmtArea(areaM2(pts))}` : '');
