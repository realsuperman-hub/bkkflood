import test from 'node:test';
import assert from 'node:assert/strict';
import { auc, bandRates, spearman, cellStats, variantReport, VARIANTS, levelOfScore } from '../src/lib/accuracy-analysis.js';

const s = (score, event, o = {}) => ({ i: 0, score, fcScore: score, event, elev: 0, tideHigh: false, wet: false, ...o });

test('AUC: perfect, none, random and ties', () => {
  assert.equal(auc([s(5, true), s(6, true), s(1, false), s(2, false)], (x) => x.score), 1);
  assert.equal(auc([s(1, true), s(2, true), s(5, false), s(6, false)], (x) => x.score), 0);
  assert.equal(auc([s(3, true), s(3, false)], (x) => x.score), 0.5);
  assert.equal(auc([s(1, true), s(1, true)], (x) => x.score), null); // no non-events
  assert.equal(auc([s(3, true), s(1, false), s(3, false)], (x) => x.score), 0.75); // beats one, ties one
});

test('bandRates gives the event rate per score', () => {
  const r = bandRates([s(1, false), s(1, true), s(2, true), s(2, true), s(2, false)], (x) => x.score);
  assert.deepEqual(r, [{ key: 1, n: 2, events: 1, rate: 0.5 }, { key: 2, n: 3, events: 2, rate: 0.667 }]);
});

test('spearman: +1 for the same order, -1 for the reverse, null for too few points', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 2], [1, 2]), null);
});

test('cellStats averages score and event rate per grid point', () => {
  const grid = [[13.5, 100.5], [13.6, 100.6]];
  const c = cellStats([s(2, true, { i: 0 }), s(4, false, { i: 0 }), s(1, false, { i: 1 })], grid);
  assert.deepEqual(c.find((x) => x.i === 0), { i: 0, lat: 13.5, lng: 100.5, n: 2, meanScore: 3, eventRate: 0.5 });
  assert.equal(c.find((x) => x.i === 1).eventRate, 0);
});

test('variants re-score the low-ground point only where the condition holds', () => {
  const base = s(4, false, { elev: 1, tideHigh: false, wet: true });
  assert.equal(VARIANTS.current(base), 4);
  assert.equal(VARIANTS.noElevation(base), 3);
  assert.equal(VARIANTS.elevOnlyWithHighTide(base), 3); // no tide → the +1 is dropped
  assert.equal(VARIANTS.elevOnlyWhenWet(base), 4); // wet → kept
  assert.equal(VARIANTS.elevOnlyWetAndHighTide(base), 3);
  assert.equal(VARIANTS.elevOnlyWetAndHighTide({ ...base, tideHigh: true }), 4);
  assert.equal(VARIANTS.current(s(4, false)), 4); // not low ground: nothing changes
  assert.equal(VARIANTS.noElevation(s(4, false)), 4);
});

test('variantReport applies the same level cut-offs as the live score', () => {
  assert.deepEqual([2, 3, 5, 7].map(levelOfScore), [0, 1, 2, 3]);
  const r = variantReport([s(3, true), s(3, false), s(0, false)], (x) => x.score);
  assert.equal(r.byLevel[0].warned, 2);
  assert.equal(r.byLevel[0].hits, 1);
  assert.equal(r.auc, 0.75);
});
