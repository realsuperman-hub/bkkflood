import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFlood, passDates, centroid, RAI_M2 } from '../src/lib/gistda-flood.js';

const hex = (lng, lat, props) => ({
  type: 'Feature',
  geometry: { type: 'MultiPolygon', coordinates: [[[[lng - 0.0005, lat - 0.0005], [lng + 0.0005, lat - 0.0005], [lng + 0.0005, lat + 0.0005], [lng - 0.0005, lat + 0.0005], [lng - 0.0005, lat - 0.0005]]]] },
  properties: props,
});

test('passDates reads the satellite pass dates out of file_name', () => {
  assert.deepEqual(passDates('rd2_20260926_0613, S1C_20260928_0550, S1D_20260928_1819'), ['2026-09-26', '2026-09-28']);
  assert.deepEqual(passDates(null), []);
});

test('centroid of a square is its middle', () => {
  const c = centroid(hex(100.5, 13.7, {}).geometry);
  assert.ok(Math.abs(c[0] - 100.5) < 1e-9 && Math.abs(c[1] - 13.7) < 1e-9);
});

test('aggregateFlood converts m² to rai, sums per province, and groups hexagons into ~550 m cells', () => {
  const feats = {
    14: [
      hex(100.5501, 14.3501, { f_area: 32000, population: 10.5, building: 1, rice_area: 16000, file_name: 'S1D_20260927_0601, S1D_20260929_1812' }),
      hex(100.5502, 14.3502, { f_area: 16000, population: 4, building: 0, rice_area: 0, file_name: 'S1D_20260929_1812' }), // same cell
      hex(100.6001, 14.4001, { f_area: 1600, population: 0, building: 0, rice_area: 0, file_name: 'rd2_20260926_0613' }), // another cell
    ],
    10: [],
  };
  const s = aggregateFlood(feats, 1);
  const ay = s.provinces.find((p) => p.id === 14);
  assert.equal(ay.polygons, 3);
  assert.equal(ay.rai, 31); // (32000 + 16000 + 1600) / 1600
  assert.equal(ay.people, 15); // 14.5 rounded
  assert.equal(ay.buildings, 1);
  assert.equal(ay.rice, 10);
  assert.equal(s.provinces.find((p) => p.id === 10).polygons, 0);
  assert.equal(s.cells.length, 2);
  assert.equal(s.cells[0][2], 30); // the two nearby hexagons: 48000 m² = 30 rai, biggest first
  assert.equal(s.cells[0][4], 14);
  assert.equal(s.lastPass, '2026-09-29');
  assert.equal(s.firstPass, '2026-09-26');
  assert.equal(RAI_M2, 1600);
});
