import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateHistory, nearbyHistory, historyGeoJson, cellOf, dayNo, CELL, mergeCells, servedSnapshot } from '../src/lib/flood-history.js';

const T = (iso) => Date.parse(`${iso}T10:00:00+07:00`);
const rep = (id, lat, lng, iso, lvl = 2) => ({ id, lat, lng, t: T(iso), lvl });

test('aggregateHistory counts distinct DAYS per cell, dedupes ids, and drops one-off cells', () => {
  const f = [
    rep('a', 13.7801, 100.5401, '2026-09-01', 2),
    rep('b', 13.7802, 100.5402, '2026-09-01', 3), // same cell, same day → still 1 day, 2 complaints
    rep('c', 13.7803, 100.5403, '2026-09-05', 1),
    rep('c', 13.7803, 100.5403, '2026-09-05', 1), // duplicate ticket id (paging overlap) → ignored
    rep('d', 13.9001, 100.7001, '2026-09-02', 3), // lonely cell: one day only → dropped
  ];
  const cells = aggregateHistory(f);
  assert.equal(cells.length, 1);
  const [, , days, n, max, first, last] = cells[0];
  assert.equal(days, 2);
  assert.equal(n, 3);
  assert.equal(max, 3);
  assert.equal(first, dayNo(T('2026-09-01')));
  assert.equal(last, dayNo(T('2026-09-05')));
  assert.equal(aggregateHistory(f, { minDays: 1 }).length, 2);
});

test('day numbers follow the Bangkok calendar (01:00 +07 is still that Bangkok day)', () => {
  assert.equal(dayNo(Date.parse('2026-09-02T01:00:00+07:00')), dayNo(Date.parse('2026-09-02T20:00:00+07:00')));
  assert.notEqual(dayNo(Date.parse('2026-09-01T23:59:00+07:00')), dayNo(Date.parse('2026-09-02T00:01:00+07:00')));
});

test('nearbyHistory looks at the 3×3 cells around a point; geojson centres are inside their cells', () => {
  const cells = aggregateHistory([
    rep('a', 13.7801, 100.5401, '2026-09-01'), rep('b', 13.7801, 100.5401, '2026-09-04'), rep('c', 13.7801, 100.5401, '2026-09-09'),
    rep('d', 13.7826, 100.5401, '2026-09-02'), rep('e', 13.7826, 100.5401, '2026-09-03'), // the next cell to the north
  ]);
  const near = nearbyHistory(cells, 13.7813, 100.5413);
  assert.equal(near.days, 3);
  assert.equal(near.n, 5);
  assert.equal(near.cells, 2);
  assert.deepEqual(nearbyHistory(cells, 13.9, 100.9), { days: 0, n: 0, max: 0, last: 0, cells: 0 });
  const g = historyGeoJson(cells);
  const [lng, lat] = g.features[0].geometry.coordinates;
  const [i, j] = cellOf(lat, lng);
  assert.deepEqual([i, j], [cells[0][0], cells[0][1]]);
  assert.ok(Math.abs(lat - 13.7801) < CELL);
  assert.equal(g.features[0].properties.days, 3);
});

test('mergeCells adds later days to existing cells; servedSnapshot keeps only repeat cells', () => {
  const early = aggregateHistory([rep('a', 13.7801, 100.5401, '2026-09-01'), rep('b', 13.9001, 100.7001, '2026-09-01')], { minDays: 1 });
  const later = aggregateHistory([rep('c', 13.7801, 100.5401, '2026-09-05', 3), rep('d', 13.6001, 100.4001, '2026-09-05')], { minDays: 1 });
  const merged = mergeCells(early, later);
  assert.equal(merged.length, 3);
  const c = merged.find((x) => x[0] === cellOf(13.7801, 100.5401)[0] && x[1] === cellOf(13.7801, 100.5401)[1]);
  assert.equal(c[2], 2); // two different days now
  assert.equal(c[3], 2);
  assert.equal(c[4], 3); // worst severity kept
  assert.equal(c[5], dayNo(T('2026-09-01')));
  assert.equal(c[6], dayNo(T('2026-09-05')));
  const snap = servedSnapshot({ from: '2026-09-01', to: '2026-09-05', complaints: 4, cells: merged }, { now: 1 });
  assert.equal(snap.cells.length, 1); // only the cell reported on ≥ 2 days is served
  assert.equal(snap.complaints, 4);
  assert.equal(mergeCells(early, []).length, early.length);
});
