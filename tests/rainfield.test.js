import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRainField, sampleRain, dropChance, rainColor, rainSummary, COVER_KM } from '../src/lib/rainfield.js';

const box = { south: 13.5, west: 100.4, north: 13.7, east: 100.6 };
const g = (lat, lng, r1, stale = false) => ({ lat, lng, r1, stale });

test('rain is strongest at the gauge and fades towards nothing beyond the cover distance', () => {
  const f = buildRainField([g(13.6, 100.5, 12)], box);
  const at = sampleRain(f, 13.6, 100.5);
  assert.ok(at.rate > 11 && at.cover > 0.95, JSON.stringify(at));
  const far = sampleRain(f, 13.5, 100.4); // ~15 km away
  assert.ok(far.cover < at.cover);
  const none = buildRainField([g(14.9, 101.5, 30)], box); // far outside
  assert.deepEqual(sampleRain(none, 13.6, 100.5), { rate: 0, cover: 0 });
  assert.ok(COVER_KM === 20);
});

test('between a wet and a dry gauge the rate is in between; stale and missing readings are ignored', () => {
  const f = buildRainField([g(13.55, 100.5, 20), g(13.65, 100.5, 0), g(13.6, 100.45, 50, true), g(13.6, 100.55, null)], box);
  const mid = sampleRain(f, 13.6, 100.5);
  assert.ok(mid.rate > 5 && mid.rate < 15, String(mid.rate));
  assert.ok(mid.rate < 20);
});

test('sampleRain is safe outside the grid and with no field', () => {
  const f = buildRainField([g(13.6, 100.5, 5)], box);
  assert.deepEqual(sampleRain(f, 10, 100), { rate: 0, cover: 0 });
  assert.deepEqual(sampleRain(null, 13.6, 100.5), { rate: 0, cover: 0 });
});

test('drop density follows the rainfall: none when dry, more as it rains harder, capped at 1; far from a gauge it thins out', () => {
  assert.equal(dropChance(0), 0);
  assert.equal(dropChance(0.1), 0);
  const [a, b, c, d] = [1, 5, 15, 40].map((r) => dropChance(r));
  assert.ok(a > 0 && a < b && b < c && c <= d && d === 1, [a, b, c, d].join());
  assert.ok(dropChance(10, 0.1) < dropChance(10, 1));
});

test('colours and the summary line', () => {
  assert.equal(rainColor(15), '#1d4e9e');
  assert.equal(rainColor(5), '#2f80c8');
  assert.equal(rainColor(0.5), '#6bb6e8');
  const s = rainSummary([g(1, 1, 12), g(1, 1, 0.1), g(1, 1, 3), g(1, 1, 50, true), g(1, 1, null)]);
  assert.equal(s.fresh, 3);
  assert.equal(s.wet, 2);
  assert.equal(s.top.r1, 12);
});
