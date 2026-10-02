// One-off deep dive into forecast accuracy (run from the Actions job on demand: workflow_dispatch with analyze_accuracy). Prints ONE JSON document to the log;
// writes nothing. Needs GOOGLE_APPLICATION_CREDENTIALS (reads the logged forecasts in Firestore `evals/`) and the public Traffy + Open-Meteo endpoints.
// Question it answers: does the risk score separate flooded places from dry ones, which part of it misleads, and would a different low-ground rule be better?
import { traffyDayUrl, normalizeFloods } from '../src/lib/traffy.js';
import { sampleGrid, labelSamples, contingency } from '../src/lib/accuracy.js';
import { auc, bandRates, spearman, cellStats, variantReport, VARIANTS, coverageMask, componentLift } from '../src/lib/accuracy-analysis.js';
import { COMP } from '../src/lib/risk.js';
import { loadRain, MARINE, GULF_POINT } from '../src/lib/forecast.js';

const now = Date.now();
const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: 'bkkflood-d54cc' });
const db = getFirestore();

const snap = await db.collection('evals').where('t', '>=', now - 9 * 86400e3).orderBy('t').get();
const records = snap.docs.map((d) => d.data());

const day = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
const from = records.length ? records[0].t - 24 * 3600e3 : now - 24 * 3600e3;
const complaints = [];
for (let t = from; t <= now + 86400e3 / 2; t += 86400e3) {
  const res = await fetch(traffyDayUrl(day(t)), { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Traffy ${day(t)} HTTP ${res.status}`);
  complaints.push(...normalizeFloods(await res.json(), now, { history: true }));
}
const uniq = [...new Map(complaints.map((c) => [c.id, c])).values()];
const grid = sampleGrid();
const samples = labelSamples(records, uniq, grid, now);

// elevation of each grid point's forecast cell (what the live rule used: Open-Meteo, 0.1° cells)
const elevOfCell = new Map();
for (const [la, ln] of grid) {
  const key = `${Math.round(la * 10) / 10},${Math.round(ln * 10) / 10}`;
  if (elevOfCell.has(key)) continue;
  try {
    elevOfCell.set(key, (await loadRain(...key.split(',').map(Number))).elevation ?? null);
  } catch {
    elevOfCell.set(key, null);
  }
}
const elevAt = (i) => elevOfCell.get(`${Math.round(grid[i][0] * 10) / 10},${Math.round(grid[i][1] * 10) / 10}`);

// the tide "high" flag at each run time, rebuilt from the sea-level series (same rule as summarizeTide: peak of the next 48 h ≥ 85th percentile and ≥ 1.3 m)
const marine = await (await fetch(`${MARINE}?latitude=${GULF_POINT.lat}&longitude=${GULF_POINT.lng}&hourly=sea_level_height_msl&past_days=14&forecast_days=10&timezone=Asia%2FBangkok`, { signal: AbortSignal.timeout(60000) })).json();
const times = marine.hourly.time;
const vals = marine.hourly.sea_level_height_msl;
const sorted = vals.filter((v) => v !== null).sort((a, b) => a - b);
const p85 = sorted[Math.floor(sorted.length * 0.85)];
const keyOf = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 13) + ':00';
const tideHighAt = (ms) => {
  const i0 = times.indexOf(keyOf(ms));
  if (i0 < 0) return null;
  const peak = Math.max(...vals.slice(i0, i0 + 48).filter((v) => v !== null));
  return peak >= p85 && peak >= 1.3;
};

const annotated = samples.map((s) => {
  const e = elevAt(s.i);
  const elev = e !== null && e !== undefined && e <= 1.5 ? 1 : 0;
  return { ...s, elev, elevM: e, tideHigh: !!tideHighAt(s.t), wet: s.fcScore - elev >= 1 };
});

const mask = coverageMask(grid, uniq, 3);
const covered = annotated.filter((s) => mask.has(s.i));
const report = (rows) => ({
  samples: rows.length,
  events: rows.filter((s) => s.event).length,
  baseRate: +(rows.filter((s) => s.event).length / rows.length).toFixed(3),
  aucOfParts: { score: auc(rows, (s) => s.score), fcScore: auc(rows, (s) => s.fcScore), fcWithoutElevation: auc(rows, (s) => s.fcScore - s.elev), obsScore: auc(rows, (s) => s.obsScore) },
  eventRateByScore: bandRates(rows, (s) => s.score),
  variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, f]) => [k, variantReport(rows, f)])),
});
const cells = cellStats(annotated, grid);
const out = {
  generatedAt: new Date(now).toISOString(),
  data: { runs: records.length, days: records.length ? +((records.at(-1).t - records[0].t) / 86400e3).toFixed(1) : 0, samples: annotated.length, events: annotated.filter((s) => s.event).length, complaints: uniq.length, hotComplaints: uniq.filter((c) => c.lvl >= 2).length },
  baseRate: +(annotated.filter((s) => s.event).length / annotated.length).toFixed(3),
  aucOfParts: { score: auc(annotated, (s) => s.score), fcScore: auc(annotated, (s) => s.fcScore), obsScore: auc(annotated, (s) => s.obsScore), persistence: auc(annotated, (s) => (s.before ? 1 : 0)) },
  eventRateByScore: bandRates(annotated, (s) => s.score),
  eventRateByFcScore: bandRates(annotated, (s) => s.fcScore),
  eventRateByObsScore: bandRates(annotated, (s) => s.obsScore),
  lowGround: {
    cellsLow: [...elevOfCell].filter(([, e]) => e !== null && e <= 1.5).length,
    cellsTotal: elevOfCell.size,
    elevations: Object.fromEntries(elevOfCell),
    eventRateLow: bandRates(annotated, (s) => s.elev),
    eventRateByTideHigh: bandRates(annotated, (s) => (s.tideHigh ? 1 : 0)),
    lowAndHighTide: contingency(annotated.filter((s) => s.elev), (s) => s.tideHigh),
  },
  variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, f]) => [k, variantReport(annotated, f)])),
  coverage: { gridPoints: grid.length, coveredPoints: mask.size, uncoveredPoints: grid.map((g, i) => (mask.has(i) ? null : g)).filter(Boolean) },
  onlyWhereComplaintsExist: report(covered),
  componentLift: { allPoints: componentLift(annotated, COMP), onlyWhereComplaintsExist: componentLift(covered, COMP), v3Samples: annotated.filter((s) => (s.v ?? 2) >= 3).length },
  spatial: {
    spearmanMeanScoreVsEventRate: spearman(cells.map((c) => c.meanScore), cells.map((c) => c.eventRate)),
    spearmanElevationVsEventRate: spearman(cells.map((c) => elevAt(c.i) ?? 0), cells.map((c) => c.eventRate)),
    topByMeanScore: [...cells].sort((a, b) => b.meanScore - a.meanScore).slice(0, 8),
    topByEventRate: [...cells].sort((a, b) => b.eventRate - a.eventRate).slice(0, 8),
  },
};
console.log('ANALYSIS_JSON_START');
console.log(JSON.stringify(out, null, 1));
console.log('ANALYSIS_JSON_END');
console.log('ANALYSIS_B64_START');
console.log(Buffer.from(JSON.stringify(out)).toString('base64').match(/.{1,200}/g).join(String.fromCharCode(10)));
console.log('ANALYSIS_B64_END');
