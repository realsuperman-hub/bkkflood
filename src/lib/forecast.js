// Open-Meteo adapters (free, no key, CORS-enabled). Non-commercial use.
// Rain: three global models are requested so we can show how much they agree.
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const FLOOD = 'https://flood-api.open-meteo.com/v1/flood';
const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'];

// Reference points for basin-scale signals (not the user's own location)
export const GULF_POINT = { lat: 13.4, lng: 100.5 }; // Upper Gulf of Thailand off the Chao Phraya mouth
const CHAINAT_POINT = { lat: 15.16, lng: 100.18 }; // Chao Phraya Dam

const memo = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p;
  const p = fn().catch((e) => {
    memo.delete(key);
    throw e;
  });
  memo.set(key, { at: Date.now(), p });
  return p;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.json();
}

const median = (a) => {
  const v = a.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);
const r1 = (x) => Math.round(x * 10) / 10;

// Bangkok local time string "YYYY-MM-DDTHH:00" for "now" (API is asked for Asia/Bangkok)
function bangkokNowKey(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 13) + ':00';
}

export function loadRain(lat, lng) {
  const key = `rain:${lat.toFixed(2)},${lng.toFixed(2)}`;
  return cached(key, 10 * 60 * 1000, async () => {
    const url =
      `${FORECAST}?latitude=${lat}&longitude=${lng}&hourly=precipitation` +
      `&models=${MODELS.join(',')}&past_days=7&forecast_days=3&timezone=Asia%2FBangkok`;
    const d = await getJson(url);
    return summarizeRain(d);
  });
}

// Antecedent Precipitation Index: rain of each of the last 7 days (24 h blocks back from now), each older day counted at
// K × the day after it. K = 0.8/day ≈ a 3-day half-life, a common choice for fast-draining urban catchments; it is an
// assumption, not a fitted value — the accuracy log is what should eventually tune it. In steady rain of R mm/day the index
// settles at R / (1 − K) = 5 R, so a wet-season Bangkok day of ~10 mm gives ≈ 50 mm.
export const API_K = 0.8;
export function antecedentIndex(hourlyMed, i0, k = API_K) {
  let api = 0;
  let total = 0;
  let days = 0;
  for (let d = 0; d < 7; d++) {
    const to = i0 - d * 24;
    const from = to - 24;
    if (from < 0) break;
    const p = sum(hourlyMed.slice(from, to));
    api += p * k ** d;
    total += p;
    days += 1;
  }
  return days >= 3 ? { api: r1(api), past7: r1(total), days } : null;
}

export function summarizeRain(d, now = Date.now()) {
  const times = d.hourly.time;
  const series = MODELS.map((m) => d.hourly[`precipitation_${m}`]).filter(Array.isArray);
  if (!series.length) throw new Error('no rain series');
  const n = times.length;
  let i0 = times.indexOf(bangkokNowKey(now));
  if (i0 < 0) i0 = Math.min(48, n - 1);

  const perHour = (i) => series.map((s) => s[i] ?? 0);
  const med = [];
  const hi = [];
  for (let i = 0; i < n; i++) {
    const v = perHour(i);
    med.push(median(v));
    hi.push(Math.max(...v));
  }
  const win = (arr, from, len) => arr.slice(from, from + len);
  const perModel24 = series.map((s) => sum(win(s, i0, 24)));

  return {
    elevation: d.elevation ?? null,
    models: series.length,
    past48: r1(sum(win(med, Math.max(0, i0 - 48), Math.min(48, i0)))),
    antecedent: antecedentIndex(med, i0),
    next6: r1(sum(win(med, i0, 6))),
    next24: r1(sum(win(med, i0, 24))),
    next48: r1(sum(win(med, i0, 48))),
    max24: r1(Math.max(...perModel24)), // wettest model
    min24: r1(Math.min(...perModel24)), // driest model
    peakHour: r1(Math.max(0, ...win(med, i0, 24))),
    hours: times.slice(i0, i0 + 48).map((t, k) => ({ t, med: r1(med[i0 + k]), hi: r1(hi[i0 + k]) })),
  };
}

// Upstream trend only. GloFAS absolute discharge is ~2x the gauge readings at Chainat
// (model bias), so we never show its magnitude — just % change over the next days.
export function loadUpstreamTrend() {
  return cached('upstream', 60 * 60 * 1000, async () => {
    const url =
      `${FLOOD}?latitude=${CHAINAT_POINT.lat}&longitude=${CHAINAT_POINT.lng}` +
      `&daily=river_discharge&forecast_days=5`;
    const q = (await getJson(url)).daily?.river_discharge?.filter((x) => x !== null) || [];
    if (q.length < 3 || !q[0]) return { pct: null, dir: 'unknown' };
    const pct = Math.round(((q[q.length - 1] - q[0]) / q[0]) * 100);
    return { pct, dir: pct > 5 ? 'rising' : pct < -5 ? 'falling' : 'steady' };
  });
}
