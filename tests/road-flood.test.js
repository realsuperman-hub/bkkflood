import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoads, lengthM, distToLinesM, summarizeRoads, nearRoads, matchRoads, bandOf, confLabel, urgency } from '../src/lib/road-flood.js';

const NOW = Date.parse('2026-10-02T08:00:00Z');
const seg = (name, o = {}) => ({
  type: 'Feature',
  geometry: { type: 'MultiLineString', coordinates: o.coords || [[[100.6, 13.75], [100.601, 13.75]]] },
  properties: { name, depthCm: 20, closedAll: false, closedSmall: false, cleared: false, conf: 0.8, updated: NOW - 600e3, hw: 'primary', verdict: { motorbike: 'caution', sedan: 'risky', pickup: 'caution', truck: 'ok' }, ...o.p },
});

test('normalizeRoads keeps only roads with water or a closure now, in a compact shape', () => {
  const out = normalizeRoads({ features: [
    seg('ถนนก'),
    seg('ถนนข', { p: { depthCm: 0 } }), // dry
    seg('ถนนค', { p: { depthCm: 0, closedAll: true } }), // closed, no depth
    seg('ถนนง', { p: { cleared: true } }), // resolved
    seg('ถนนจ', { coords: [[[110, 13.7], [110.1, 13.7]]] }), // outside the service area
    { type: 'Feature', geometry: { type: 'Point', coordinates: [100.6, 13.7] }, properties: { depthCm: 30 } },
  ] }, NOW);
  assert.deepEqual(out.map((f) => f.properties.n), ['ถนนก', 'ถนนค']);
  assert.deepEqual(out[0].properties.v, [1, 2, 1, 0]);
  assert.equal(out[0].properties.c, 80);
  assert.equal(out[1].properties.a, 1);
  assert.throws(() => normalizeRoads({}), /unexpected/);
});

test('length and distance helpers work in metres', () => {
  const line = [[[100.6, 13.75], [100.601, 13.75]]];
  assert.ok(Math.abs(lengthM(line) - 108) < 3); // 0.001° of longitude at 13.75°N ≈ 108 m
  assert.ok(distToLinesM(line, 13.75, 100.6005) < 1);
  assert.ok(Math.abs(distToLinesM(line, 13.7509, 100.6005) - 100) < 3); // 0.0009° north ≈ 100 m
});

test('summary groups segments by road and ranks by urgency; nameless roads stay out of the list', () => {
  const f = normalizeRoads({ features: [
    seg('ถนนลึก', { p: { depthCm: 60, conf: 0.9 } }),
    seg('ถนนลึก', { p: { depthCm: 10, conf: 0.5 }, coords: [[[100.61, 13.75], [100.611, 13.75]]] }),
    seg('ซอยตื้น', { p: { depthCm: 10 } }),
    seg('', { p: { depthCm: 90 } }),
    seg('ถนนปิด', { p: { depthCm: 20, closedAll: true, conf: 0.9 } }),
  ] }, NOW);
  const s = summarizeRoads(f, NOW);
  assert.equal(s.segments, 5);
  assert.equal(s.roads, 3);
  assert.equal(s.maxD, 90);
  assert.equal(s.top[0].name, 'ถนนลึก');
  assert.equal(s.top[0].maxD, 60);
  assert.equal(s.top[0].segs, 2);
  assert.equal(s.top.some((g) => !g.name), false);
  assert.ok(urgency(s.top[0], NOW) > urgency(s.top[s.top.length - 1], NOW));
});

test('nearRoads and matchRoads find roads by place and by name', () => {
  const f = normalizeRoads({ features: [seg('ถนนรามคำแหง'), seg('ซอยลาดพร้าว 107', { coords: [[[100.7, 13.8], [100.701, 13.8]]] })] }, NOW);
  assert.deepEqual(nearRoads(f, 13.75, 100.6005, 300, NOW).map((g) => g.name), ['ถนนรามคำแหง']);
  assert.equal(nearRoads(f, 13.75, 100.6005, 300, NOW)[0].m < 5, true);
  assert.deepEqual(matchRoads(f, 'ลาดพร้าว', 8, NOW).map((g) => g.name), ['ซอยลาดพร้าว 107']);
  assert.deepEqual(matchRoads(f, 'ร', 8, NOW), []); // too short
});

test('bands and confidence labels', () => {
  assert.equal(bandOf(0), null);
  assert.equal(bandOf(10).min, 1);
  assert.equal(bandOf(35).min, 30);
  assert.equal(bandOf(120).min, 50);
  assert.deepEqual([90, 50, 10].map(confLabel), ['สูง', 'กลาง', 'ต่ำ']);
});
