// Wind and sea-current fields for the animated flow layers. Open-Meteo gives a speed and a direction per grid point; the animation needs a vector field it can
// sample anywhere. A field is { lat0 (south edge), lng0 (west edge), step, ny, nx, u[], v[] } in row-major order from south to north, with null where
// there is no value (land for sea currents). u = towards east, v = towards north, in m/s. DOM-free — scripts/fetch-wind.mjs builds it, src/ui/flow-layer.js draws it.

// meteorological direction = where the flow comes FROM (0° = from the north); a current direction (oceanographic) is where it goes TO
export function toUV(speed, deg, from = true) {
  if (!Number.isFinite(speed) || !Number.isFinite(deg)) return [null, null];
  const r = ((from ? deg + 180 : deg) * Math.PI) / 180; // direction the flow moves towards
  return [+(speed * Math.sin(r)).toFixed(3), +(speed * Math.cos(r)).toFixed(3)];
}

// grid of [lat, lng] points, south→north then west→east (the order the field arrays use)
export function gridPoints({ lat0, lng0, step, ny, nx }) {
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push([+(lat0 + j * step).toFixed(4), +(lng0 + i * step).toFixed(4)]);
  return out;
}

export function buildField(spec, readings) {
  const u = [];
  const v = [];
  for (const r of readings) {
    const [a, b] = r ? toUV(r.speed, r.deg, r.from) : [null, null];
    u.push(a);
    v.push(b);
  }
  return { ...spec, u, v };
}

export const validShare = (f) => (f?.u?.length ? f.u.filter((x) => x !== null).length / f.u.length : 0);

// bilinear [u, v] at a point, or null when outside the grid or any of the four corners has no value
export function sample(f, lat, lng) {
  if (!f) return null;
  const x = (lng - f.lng0) / f.step;
  const y = (lat - f.lat0) / f.step;
  if (!(x >= 0 && y >= 0 && x <= f.nx - 1 && y <= f.ny - 1)) return null;
  const i = Math.min(Math.floor(x), f.nx - 2);
  const j = Math.min(Math.floor(y), f.ny - 2);
  const fx = x - i;
  const fy = y - j;
  const at = (a, b) => f.u[b * f.nx + a] !== null && f.v[b * f.nx + a] !== null ? [f.u[b * f.nx + a], f.v[b * f.nx + a]] : null;
  const c = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
  if (c.some((p) => p === null)) return null;
  const w = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  return [0, 1].map((k) => c.reduce((s, p, n) => s + p[k] * w[n], 0));
}

export const speedOf = (uv) => (uv ? Math.hypot(uv[0], uv[1]) : null);

// the direction the flow comes FROM, in degrees (wind convention), from a [u, v] vector
export const fromDeg = (uv) => (((Math.atan2(-uv[0], -uv[1]) * 180) / Math.PI) + 360) % 360;
const COMPASS = ['เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้', 'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ'];
export const compassTh = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// Beaufort-like words for a wind speed in m/s
export const windWord = (ms) => (ms < 0.5 ? 'ลมสงบ' : ms < 3.4 ? 'ลมอ่อน' : ms < 8 ? 'ลมปานกลาง' : ms < 14 ? 'ลมแรง' : 'ลมแรงมาก');

// the colour of a particle by speed (m/s for wind, km/h for the sea); stops are [maxSpeed, colour]
export const WIND_COLORS = [[2, '#5b9bd5'], [5, '#2f6fba'], [8, '#1f3fae'], [Infinity, '#7b2cbf']];
export const SEA_COLORS = [[0.5, '#3ab5c4'], [1, '#0e8f9f'], [2, '#0b6b7a'], [Infinity, '#08485a']];
export const colorFor = (stops, speed) => (stops.find(([max]) => speed < max) || stops.at(-1))[1];
