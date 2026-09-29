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

// Fixed sample grid over Bangkok + vicinity (~6.5 km spacing). Order is part of the log format — do not reorder.
export function sampleGrid() {
  const pts = [];
  for (let la = 13.56; la <= 13.981; la += 0.06) for (let ln = 100.34; ln <= 100.921; ln += 0.06) pts.push([+la.toFixed(3), +ln.toFixed(3)]);
  return pts;
}

// Compact log record: p = [[index, level, score, fcScore, obsScore], ...]
export const makeRecord = (t, results) => ({ t, v: 1, p: results.map((r) => [r.i, r.level, r.score, r.fcScore, r.obsScore]) });

const near = (a, b) => Math.abs(a[0] - b[0]) < 0.03 && Math.abs(a[1] - b[1]) < 0.03 && distKm(a[0], a[1], b[0], b[1]) <= RADIUS_KM;

// complaints: [{ t, lat, lng, lvl }]  → one labelled sample per (record, point)
export function labelSamples(records, complaints, grid, now = Date.now()) {
  const hot = complaints.filter((c) => c.lvl >= MIN_EVENT_LVL);
  const out = [];
  for (const rec of records) {
    if (rec.t + HORIZON_MS > now) continue; // the 24 h outcome window is not complete yet
    const win = hot.filter((c) => c.t > rec.t - HORIZON_MS && c.t <= rec.t + HORIZON_MS);
    for (const [i, level, score, fcScore, obsScore] of rec.p) {
      const g = grid[i];
      if (!g) continue;
      let event = false;
      let before = false;
      for (const c of win) {
        if (!near(g, [c.lat, c.lng])) continue;
        if (c.t > rec.t) event = true;
        else before = true; // already flooded in the 24 h before the forecast
      }
      out.push({ t: rec.t, level, score, fcScore, obsScore, event, before });
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

export function buildReport(records, complaints, grid, now = Date.now()) {
  const samples = labelSamples(records, complaints, grid, now);
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
    baseRate: samples.length ? +(events / samples.length).toFixed(3) : null,
    // the system's overall level (1 watch, 2 prepare, 3 danger)
    byLevel: [1, 2, 3].map((th) => ({ th, ...contingency(samples, (s) => s.level >= th) })),
    // forecast-only part (rain/tide/terrain) — is the forecast itself any good?
    byForecast: [1, 2, 3, 4].map((th) => ({ th, ...contingency(samples, (s) => s.fcScore >= th) })),
    // benchmark to beat: "it flooded here yesterday, so it will flood again"
    persistence: contingency(samples, (s) => s.before),
    note: 'ใช้เรื่องแจ้งน้ำท่วมระดับปานกลาง/หนักที่ผู้ประชาชนแจ้ง กทม. ภายใน 24 ชม. รัศมี 2 กม. เป็นเหตุการณ์จริง (ตัวแทนที่ไม่สมบูรณ์)',
  };
}
