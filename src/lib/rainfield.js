// From rain-gauge readings to "how hard is it raining HERE" for the animated rain layer. Each fresh gauge has rain_1h (mm that fell in the last hour); between gauges the
// value is an inverse-distance average, and the further a point is from every gauge the less it is trusted: beyond COVER_KM the layer shows nothing (no gauge = unknown,
// never "dry"). The result is a coarse grid { lat0, lng0, step, ny, nx, r[], c[] } (rate in mm/h and coverage 0..1) so the animation can look cells up cheaply. DOM-free.
import { distKm } from './geo.js';

export const COVER_KM = 20;

// gauges: [{ lat, lng, r1, stale }] → field over the box (south, west, north, east)
export function buildRainField(gauges, box, step = 0.02) {
  const g = gauges.filter((x) => !x.stale && x.r1 !== null && x.r1 !== undefined && Number.isFinite(x.lat) && Number.isFinite(x.lng));
  const ny = Math.floor((box.north - box.south) / step) + 1;
  const nx = Math.floor((box.east - box.west) / step) + 1;
  const r = new Array(ny * nx).fill(0);
  const c = new Array(ny * nx).fill(0);
  const pad = COVER_KM / 100; // degrees, cheap pre-filter (≈ 2 × the cover distance)
  for (let j = 0; j < ny; j++) {
    const lat = box.south + j * step;
    for (let i = 0; i < nx; i++) {
      const lng = box.west + i * step;
      let sw = 0, sv = 0, dmin = Infinity;
      for (const p of g) {
        if (Math.abs(p.lat - lat) > pad || Math.abs(p.lng - lng) > pad) continue;
        const d = distKm(lat, lng, p.lat, p.lng);
        if (d > COVER_KM) continue;
        dmin = Math.min(dmin, d);
        const w = 1 / (d + 1) ** 2;
        sw += w;
        sv += w * p.r1;
      }
      if (sw > 0) {
        r[j * nx + i] = +(sv / sw).toFixed(2);
        c[j * nx + i] = +(1 - dmin / COVER_KM).toFixed(2);
      }
    }
  }
  return { lat0: box.south, lng0: box.west, step, ny, nx, r, c };
}

// nearest-cell lookup → { rate, cover } (zeros outside the grid)
export function sampleRain(f, lat, lng) {
  if (!f) return { rate: 0, cover: 0 };
  const i = Math.round((lng - f.lng0) / f.step);
  const j = Math.round((lat - f.lat0) / f.step);
  if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) return { rate: 0, cover: 0 };
  return { rate: f.r[j * f.nx + i], cover: f.c[j * f.nx + i] };
}

// chance (0..1) that a spawn attempt at a place produces a drop: nothing below 0.2 mm/h, about 0.45 at 5 mm/h, full at 20 mm/h and more, and thinner where only a far gauge speaks
export const dropChance = (rate, cover = 1) => (rate < 0.2 ? 0 : Math.min(1, (rate / 20) ** 0.6) * Math.min(1, 0.25 + cover));

// the words and blue shade for a rate (same bands as the gauge colours in rain-obs.js)
export const RAIN_BANDS = [
  { min: 10, label: 'ฝนหนัก (10 มม./ชม. ขึ้นไป)', color: '#1d4e9e' },
  { min: 2.5, label: 'ฝนปานกลาง (2.5–10)', color: '#2f80c8' },
  { min: 0.2, label: 'ฝนเล็กน้อย (ต่ำกว่า 2.5)', color: '#6bb6e8' },
];
export const rainColor = (rate) => (RAIN_BANDS.find((b) => rate >= b.min) || RAIN_BANDS.at(-1)).color;

// a short summary for the readout: how many fresh gauges, how many reporting rain, the heaviest
export function rainSummary(gauges) {
  const fresh = gauges.filter((g) => !g.stale && g.r1 !== null && g.r1 !== undefined);
  const wet = fresh.filter((g) => g.r1 >= 0.2).sort((a, b) => b.r1 - a.r1);
  return { fresh: fresh.length, wet: wet.length, top: wet[0] || null };
}
