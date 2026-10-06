import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleGrid, makeRecord, labelSamples, contingency, buildReport, HORIZON_MS, REPORT_MIN_V } from '../src/lib/accuracy.js';

const grid = sampleGrid();
const T = Date.parse('2026-09-20T00:00:00Z');
const now = T + 5 * 86400e3;

test('grid is stable and inside the service area', () => {
  assert.ok(grid.length >= 60 && grid.length <= 120, `grid size ${grid.length}`);
  assert.ok(grid.every(([la, ln]) => la > 13.3 && la < 14.4 && ln > 99.9 && ln < 101.1));
});

test('labelSamples: event only for complaints AFTER the forecast, nearby, medium+; "before" marks persistence', () => {
  const [la, ln] = grid[10];
  const rec = makeRecord(T, [{ i: 10, level: 2, score: 5, fcScore: 3, obsScore: 2 }, { i: 30, level: 0, score: 0, fcScore: 0, obsScore: 0 }]);
  const c = (dt, lvl, dla = 0) => ({ t: T + dt, lat: la + dla, lng: ln, lvl });
  const s = labelSamples([rec], [c(3600e3, 3), c(-3600e3, 2), c(3600e3, 1), c(3600e3, 3, 0.2), c(HORIZON_MS + 1000, 3)], grid, now);
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].event, s[0].before], [true, true]); // heavy complaint after, medium before
  assert.deepEqual([s[1].event, s[1].before], [false, false]); // other point untouched
});

test('records whose 24 h outcome is incomplete are skipped', () => {
  const rec = makeRecord(now - 3600e3, [{ i: 0, level: 3, score: 9, fcScore: 5, obsScore: 4 }]);
  assert.equal(labelSamples([rec], [], grid, now).length, 0);
});

test('contingency metrics', () => {
  const samples = [
    { level: 2, event: true }, { level: 2, event: true }, { level: 2, event: false },
    { level: 0, event: true }, { level: 0, event: false }, { level: 0, event: false }, { level: 0, event: false },
  ];
  const c = contingency(samples, (s) => s.level >= 2);
  assert.deepEqual([c.hits, c.misses, c.falseAlarms, c.correctNeg], [2, 1, 1, 3]);
  assert.equal(c.pod, 0.667);
  assert.equal(c.far, 0.333);
  assert.equal(c.csi, 0.5);
  assert.equal(contingency([], () => true).pod, null);
});

test('buildReport says "not ready" until enough days and events', () => {
  const recs = [T, T + 3600e3].map((t) => makeRecord(t, [{ i: 0, level: 2, score: 5, fcScore: 3, obsScore: 2 }]));
  const near0 = [{ t: T - 3600e3, lat: grid[0][0], lng: grid[0][1], lvl: 1 }]; // a complaint near point 0: the feed is alive there
  const r = buildReport(recs, near0, grid, now);
  assert.equal(r.ready, false);
  assert.equal(r.samples, 2);
  assert.equal(r.byLevel.length, 3);
});

test('buildReport grades only grid points that have complaint activity nearby (the feed does not exist outside Bangkok)', () => {
  const recs = [makeRecord(T, [{ i: 0, level: 2, score: 5, fcScore: 3, obsScore: 2 }, { i: 40, level: 2, score: 5, fcScore: 3, obsScore: 2 }])];
  const r = buildReport(recs, [{ t: T + 3600e3, lat: grid[0][0], lng: grid[0][1], lvl: 3 }], grid, now);
  assert.equal(r.samples, 1); // point 40 has no complaint anywhere near it → not graded
  assert.equal(r.events, 1);
  assert.deepEqual([r.coverage.gridPoints, r.coverage.coveredPoints, r.coverage.samplesBeforeMask], [grid.length, 1, 2]);
});

test('log format v4 (same layout as v3) carries the component mask; v2 records (stride 5) are still read', () => {
  const v3 = makeRecord(T, [{ i: 3, level: 1, score: 3, fcScore: 1, obsScore: 2, comp: 0b101 }]);
  assert.equal(v3.v, 4);
  assert.deepEqual(v3.p, [3, 1, 3, 1, 2, 5]);
  const v2 = { t: T, v: 2, p: [3, 1, 3, 1, 2, 4, 2, 5, 3, 2] }; // two samples, stride 5
  const s = labelSamples([v2, v3], [], grid, now);
  assert.deepEqual(s.map((x) => [x.i, x.comp, x.v]), [[3, 0, 2], [4, 0, 2], [3, 5, 4]]);
});

test('buildReport grades only records made with the current score rules, and counts the flood days behind the numbers', () => {
  const old = { t: T, v: 3, p: [0, 2, 5, 3, 2, 0] };
  const cur = makeRecord(T + 3600e3, [{ i: 0, level: 2, score: 5, fcScore: 3, obsScore: 2 }]);
  assert.ok(cur.v >= REPORT_MIN_V && old.v < REPORT_MIN_V);
  const at = (dt, lvl) => ({ t: T + dt, lat: grid[0][0], lng: grid[0][1], lvl });
  // two medium/heavy complaints on the same Bangkok day, one on the next day, a light one (never a flood day), one elsewhere on the first day
  const complaints = [at(2 * 3600e3, 3), at(3 * 3600e3, 2), at(20 * 3600e3, 2), at(4 * 3600e3, 1), { t: T + 2 * 3600e3, lat: grid[40][0], lng: grid[40][1], lvl: 3 }];
  const r = buildReport([old, cur], complaints, grid, now);
  assert.equal(r.runs, 1);
  assert.equal(r.samples, 1);
  assert.equal(r.rulesSince, cur.t);
  assert.equal(r.floodDays, 2);
});
