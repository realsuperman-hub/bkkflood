import test from 'node:test';
import assert from 'node:assert/strict';
import { lengthM, areaM2, anchor, flatten, unflatten, toGeometry, validate, fmtLen, describe } from '../src/lib/shape.js';

const inB = (la, ln) => la > 13.3 && la < 14.4 && ln > 99.9 && ln < 101.1;
// ~111 m north, then ~111 m east (at lat 13.75 → 0.001° lng ≈ 108 m)
const L = [[13.75, 100.5], [13.751, 100.5], [13.751, 100.501]];

test('length and anchor (midpoint by distance)', () => {
  const m = lengthM(L);
  assert.ok(m > 210 && m < 225, `length ${m}`);
  const [la, ln] = anchor('line', L);
  assert.ok(la > 13.7505 && la <= 13.751 + 1e-9 && ln >= 100.5, 'anchor lies on the path');
  assert.deepEqual(anchor('point', [[13.7, 100.5]]), [13.7, 100.5]);
});

test('area of a ~100 m square is ~10,000 m²', () => {
  const sq = [[13.75, 100.5], [13.75, 100.50093], [13.75090, 100.50093], [13.75090, 100.5]];
  const a = areaM2(sq);
  assert.ok(a > 9000 && a < 11000, `area ${a}`);
});

test('flatten/unflatten round-trip and GeoJSON order is [lng, lat]', () => {
  const flat = flatten(L);
  assert.deepEqual(flat, [13.75, 100.5, 13.751, 100.5, 13.751, 100.501]);
  assert.deepEqual(unflatten(flat), L);
  assert.deepEqual(toGeometry('line', L).coordinates[0], [100.5, 13.75]);
  const poly = toGeometry('area', L).coordinates[0];
  assert.deepEqual(poly[0], poly.at(-1), 'polygon ring is closed');
});

test('validation', () => {
  assert.equal(validate('line', L, inB), null);
  assert.match(validate('line', [L[0]], inB), /2 จุด/);
  assert.match(validate('area', L.slice(0, 2), inB), /3 จุด/);
  assert.match(validate('line', [[13.75, 100.5], [20, 100.5]], inB), /นอกพื้นที่/);
  assert.match(validate('line', Array.from({ length: 41 }, (_, i) => [13.75 + i * 1e-4, 100.5]), inB), /ไม่เกิน 40/);
  assert.match(validate('line', [[13.75, 100.5], [13.75, 100.50001]], inB), /สั้น/);
});

test('formatting', () => {
  assert.equal(fmtLen(350), '350 ม.');
  assert.equal(fmtLen(1234), '1.23 กม.');
  assert.match(describe('line', L), /^ยาว ≈ 2\d\d ม\.$/);
});
