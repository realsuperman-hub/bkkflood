import test from 'node:test';
import assert from 'node:assert/strict';
import { tideColor, hourIndex, levelAt, nearestPoint, highTides, peakIn, HOUR } from '../src/lib/tidefield.js';

const T0 = Date.parse('2026-10-03T00:00:00Z');
const tide = {
  t0: T0, hours: 8,
  pts: [
    { la: 13.5, ln: 100.5, h: [10, 60, 120, 150, 140, 90, 100, 130] },
    { la: 12, ln: 101, h: [null, null, null, null, null, null, null, null] },
    { la: 8, ln: 102, h: [0, 5, 10, 5, 0, -5, -10, -5] },
  ],
};

test('colours run from deep blue (low) through pale (mean level) to red (high), clamped', () => {
  assert.equal(tideColor(-5), tideColor(-1.6));
  assert.equal(tideColor(9), tideColor(1.6));
  assert.equal(tideColor(0), '#d7ebf5');
  assert.notEqual(tideColor(-1), tideColor(1));
  assert.match(tideColor(0.4), /^#[0-9a-f]{6}$/);
});

test('hourIndex floors to the hour and stays inside the series; null without a series', () => {
  assert.equal(hourIndex(tide, T0 + 2.5 * HOUR), 2);
  assert.equal(hourIndex(tide, T0 - 5 * HOUR), 0);
  assert.equal(hourIndex(tide, T0 + 99 * HOUR), 7);
  assert.equal(hourIndex(null), null);
});

test('levelAt returns metres and null for a missing value', () => {
  assert.equal(levelAt(tide.pts[0], 3), 1.5);
  assert.equal(levelAt(tide.pts[1], 3), null);
  assert.equal(levelAt(tide.pts[0], 99), null);
});

test('nearestPoint finds the closest sea point within the distance, else null', () => {
  assert.equal(nearestPoint(tide, 13.4, 100.6).la, 13.5);
  assert.equal(nearestPoint(tide, 10, 104, 80), null);
  assert.equal(nearestPoint(null, 13, 100), null);
});

test('highTides lists the local maxima from an hour on, with their time and height', () => {
  const h = highTides(tide, tide.pts[0]);
  assert.deepEqual(h.map((x) => [x.i, x.m]), [[3, 1.5]]); // 150 at hour 3; the rise to 130 at the very end is not a confirmed peak
  assert.equal(h[0].t, T0 + 3 * HOUR);
  assert.deepEqual(highTides(tide, tide.pts[0], 4), []);
});

test('peakIn gives the highest value of a window', () => {
  const p = peakIn(tide, tide.pts[0], 0, 8);
  assert.deepEqual([p.i, p.m], [3, 1.5]);
  assert.equal(peakIn(tide, tide.pts[1], 0, 8), null);
});
