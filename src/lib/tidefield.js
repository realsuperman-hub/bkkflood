// Hourly sea level over the Gulf of Thailand (Open-Meteo Marine `sea_level_height_msl`: tide + surge, metres above mean sea level, a model on a coarse grid).
// scripts/fetch-tide.mjs stores the points that are sea; this file has the pure helpers the map layer and the control bar use. DOM-free.
//   tide = { generatedAt, t0 (ms of the first hour), hours, pts: [{ la, ln, h: [cm per hour, null = no value] }] }

export const TIDE_SPEC = { lat0: 6.5, lng0: 99, step: 0.5, ny: 15, nx: 13 }; // 6.5–13.5 N, 99–105 E
export const HOUR = 3600e3;

// metres → colour: deep blue (low water) … pale (mean sea level) … orange/red (high water); clamped to ±1.6 m
const STOPS = [
  [-1.6, [20, 60, 160]],
  [-0.8, [70, 150, 220]],
  [0, [215, 235, 245]],
  [0.8, [250, 190, 80]],
  [1.6, [200, 40, 50]],
];
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export function tideColor(m) {
  const x = Math.max(-1.6, Math.min(1.6, m));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [x0, c0] = STOPS[i - 1];
      const [x1, c1] = STOPS[i];
      const t = (x - x0) / (x1 - x0);
      return hex(c0.map((v, k) => Math.round(v + (c1[k] - v) * t)));
    }
  }
  return hex(STOPS.at(-1)[1]);
}

// the hour index of `now` in the series (floored), clamped to the range; null when there is no series
export function hourIndex(tide, now = Date.now()) {
  if (!tide?.hours) return null;
  return Math.max(0, Math.min(tide.hours - 1, Math.floor((now - tide.t0) / HOUR)));
}

// metres at a point and hour (null = no value)
export const levelAt = (pt, i) => (pt.h[i] === null || pt.h[i] === undefined ? null : pt.h[i] / 100);

// the closest point to a place, within maxKm (null when none)
export function nearestPoint(tide, lat, lng, maxKm = 80) {
  let best = null;
  let bd = Infinity;
  for (const p of tide?.pts || []) {
    const dy = (p.la - lat) * 111.2;
    const dx = (p.ln - lng) * 111.2 * Math.cos((lat * Math.PI) / 180);
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= maxKm ? best : null;
}

// local maxima of a point's series from hour `from` on: [{ i, t, m }] — a high tide is an hour higher than both neighbours (or equal to the previous and higher than the next)
export function highTides(tide, pt, from = 0) {
  const out = [];
  for (let i = Math.max(1, from); i < tide.hours - 1; i++) {
    const a = pt.h[i - 1], b = pt.h[i], c = pt.h[i + 1];
    if (a === null || b === null || c === null || a === undefined || c === undefined) continue;
    if (b >= a && b > c) out.push({ i, t: tide.t0 + i * HOUR, m: b / 100 });
  }
  return out;
}

// the highest water in the series window [from, to) for a point
export function peakIn(tide, pt, from, to) {
  let best = null;
  for (let i = from; i < Math.min(to, tide.hours); i++) if (pt.h[i] !== null && pt.h[i] !== undefined && (best === null || pt.h[i] > best.cm)) best = { i, cm: pt.h[i], t: tide.t0 + i * HOUR };
  return best ? { i: best.i, t: best.t, m: best.cm / 100 } : null;
}
