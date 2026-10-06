// Grades the warning system against what actually happened. DOM-free and Firestore-free so it can be unit-tested.
//
// Every ~15 min the server logs, for a fixed grid of sample points, the risk it computed (log-eval.mjs).
// Later, evaluate-accuracy.mjs compares each log with the flood complaints that arrived in the next 24 h nearby.
// Honest caveat: complaints are a proxy — they under-count sparsely populated areas and over-count dense ones.
import { distKm } from './geo.js';

export const HORIZON_MS = 24 * 3600e3;
export const RADIUS_KM = 2;
export const MIN_EVENT_LVL = 2; // count "medium" and "heavy" complaints as a flood event
export const READY = { minDays: 3, minEvents: 30 }; // below this the site says "still collecting"
export const SETTLED_FLOOD_DAYS = 5; // fewer flood days than this → the numbers mostly describe one or two storms, and the site says so
// The public report grades only records made with the CURRENT score rules, so it never mixes rule sets. v4 (2026-10-06): regional/upstream no longer scored;
// v5 (2026-10-06, hours later): "high tide" from the official tide table instead of Open-Meteo.
// Older versions stay readable for the deep-dive, which can replay them from the logged score parts.
export const REPORT_MIN_V = 5;
export const KEEP_DAYS = 45; // evals/ retention: long enough to hold several storms (10 days held one)

// Fixed sample grid over Bangkok + vicinity (~6.5 km spacing). Order is part of the log format — do not reorder.
export function sampleGrid() {
  const pts = [];
  for (let la = 13.56; la <= 13.981; la += 0.06) for (let ln = 100.34; ln <= 100.921; ln += 0.06) pts.push([+la.toFixed(3), +ln.toFixed(3)]);
  return pts;
}

// Compact log record. Firestore forbids nested arrays, so p is FLAT. v3 (from 2026-10-02) and v4/v5 (from 2026-10-06: same layout, new score rules) have stride 6: [index, level, score, fcScore, obsScore, comp, index, ...]
// where comp is the bit mask of the score parts that fired (risk.js COMP). v2 records (stride 5, no comp) are still read; from v3 on low ground is not scored.
export const STRIDE = 6;
export const makeRecord = (t, results) => ({ t, v: 5, p: results.flatMap((r) => [r.i, r.level, r.score, r.fcScore, r.obsScore, r.comp ?? 0]) });
const rows = (rec) => {
  const stride = (rec.v ?? 2) >= 3 ? 6 : 5;
  const out = [];
  for (let k = 0; k + stride <= rec.p.length; k += stride) {
    const r = rec.p.slice(k, k + stride);
    out.push(stride === 5 ? [...r, 0] : r);
  }
  return out;
};

// The complaint feed (Traffy, BMA's own team) only exists inside Bangkok: a grid point in Nonthaburi, Pathum Thani or Samut Prakan can never have an "event",
// so every warning there would count as a false alarm. A point is gradable only if the feed shows life nearby: a complaint of ANY severity within radiusKm.
export function coverageMask(grid, complaints, radiusKm = 3) {
  const ok = new Set();
  grid.forEach(([la, ln], i) => {
    if (complaints.some((c) => Math.abs(c.lat - la) < 0.04 && Math.abs(c.lng - ln) < 0.04 && distKm(la, ln, c.lat, c.lng) <= radiusKm)) ok.add(i);
  });
  return ok;
}

const near = (a, b) => Math.abs(a[0] - b[0]) < 0.03 && Math.abs(a[1] - b[1]) < 0.03 && distKm(a[0], a[1], b[0], b[1]) <= RADIUS_KM;

// complaints: [{ t, lat, lng, lvl }]  → one labelled sample per (record, point)
export function labelSamples(records, complaints, grid, now = Date.now()) {
  const hot = complaints.filter((c) => c.lvl >= MIN_EVENT_LVL);
  const out = [];
  for (const rec of records) {
    if (rec.t + HORIZON_MS > now) continue; // the 24 h outcome window is not complete yet
    const win = hot.filter((c) => c.t > rec.t - HORIZON_MS && c.t <= rec.t + HORIZON_MS);
    for (const [i, level, score, fcScore, obsScore, comp] of rows(rec)) {
      const g = grid[i];
      if (!g) continue;
      let event = false;
      let before = false;
      for (const c of win) {
        if (!near(g, [c.lat, c.lng])) continue;
        if (c.t > rec.t) event = true;
        else before = true; // already flooded in the 24 h before the forecast
      }
      out.push({ i, t: rec.t, level, score, fcScore, obsScore, comp, v: rec.v ?? 2, event, before });
    }
  }
  return out;
}

// predict(sample) → true if the system "warned"
export function contingency(samples, predict) {
  let hits = 0, misses = 0, falseAlarms = 0, correctNeg = 0;
  for (const s of samples) {
    const w = !!predict(s);
    if (w && s.event) hits++;
    else if (!w && s.event) misses++;
    else if (w && !s.event) falseAlarms++;
    else correctNeg++;
  }
  const r = (a, b) => (b > 0 ? +(a / b).toFixed(3) : null);
  return {
    warned: hits + falseAlarms,
    hits, misses, falseAlarms, correctNeg,
    pod: r(hits, hits + misses), // of real events, share warned in advance (higher = better)
    far: r(falseAlarms, hits + falseAlarms), // of warnings, share with no event (lower = better)
    csi: r(hits, hits + misses + falseAlarms),
  };
}

const bkkDay = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);

// Distinct Bangkok days with a medium/heavy complaint near a gradable point while the logs ran: how many separate floods the numbers rest on.
export function floodDays(records, complaints, grid, mask) {
  if (!records.length) return 0;
  const from = records[0].t;
  const to = records.at(-1).t + HORIZON_MS;
  const days = new Set();
  for (const c of complaints) {
    if (c.lvl < MIN_EVENT_LVL || c.t <= from || c.t > to) continue;
    if ([...mask].some((i) => near(grid[i], [c.lat, c.lng]))) days.add(bkkDay(c.t));
  }
  return days.size;
}

export function buildReport(allRecords, complaints, grid, now = Date.now()) {
  const records = allRecords.filter((r) => (r.v ?? 2) >= REPORT_MIN_V);
  const all = labelSamples(records, complaints, grid, now);
  const mask = coverageMask(grid, complaints, 3);
  const samples = all.filter((s) => mask.has(s.i)); // only where complaints can be seen at all
  const events = samples.filter((s) => s.event).length;
  const days = records.length ? +((records.at(-1).t - records[0].t) / 86400e3).toFixed(1) : 0;
  const graded = new Set(samples.map((s) => s.t)).size;
  const ready = samples.length > 0 && days >= READY.minDays && events >= READY.minEvents;
  return {
    generatedAt: now,
    ready,
    need: READY,
    runs: records.length,
    gradedRuns: graded,
    days,
    samples: samples.length,
    events,
    floodDays: floodDays(records, complaints, grid, mask),
    settledFloodDays: SETTLED_FLOOD_DAYS,
    rulesSince: records[0]?.t ?? null,
    baseRate: samples.length ? +(events / samples.length).toFixed(3) : null,
    coverage: { gridPoints: grid.length, coveredPoints: mask.size, samplesBeforeMask: all.length },
    // the system's overall level (1 watch, 2 prepare, 3 danger)
    byLevel: [1, 2, 3].map((th) => ({ th, ...contingency(samples, (s) => s.level >= th) })),
    // forecast-only part (rain/tide/terrain) — is the forecast itself any good?
    byForecast: [1, 2, 3, 4].map((th) => ({ th, ...contingency(samples, (s) => s.fcScore >= th) })),
    // benchmark to beat: "it flooded here yesterday, so it will flood again"
    persistence: contingency(samples, (s) => s.before),
    note: 'ใช้เรื่องแจ้งน้ำท่วมระดับปานกลาง/หนักที่ผู้ประชาชนแจ้ง กทม. ภายใน 24 ชม. รัศมี 2 กม. เป็นเหตุการณ์จริง (ตัวแทนที่ไม่สมบูรณ์)',
  };
}
