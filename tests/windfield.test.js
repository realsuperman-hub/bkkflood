import test from 'node:test';
import assert from 'node:assert/strict';
import { toUV, gridPoints, buildField, validShare, sample, speedOf, fromDeg, compassTh, windWord, colorFor, WIND_COLORS } from '../src/lib/windfield.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('a wind FROM the south blows towards the north (v > 0), FROM the east blows towards the west (u < 0)', () => {
  const [u1, v1] = toUV(4, 180);
  near(u1, 0); near(v1, 4);
  const [u2, v2] = toUV(3, 90);
  near(u2, -3); near(v2, 0);
  const [u3, v3] = toUV(2, 90, false); // a current heading east
  near(u3, 2); near(v3, 0);
  assert.deepEqual(toUV(null, 90), [null, null]);
});

test('fromDeg and compassTh give back the direction the wind comes from, in Thai', () => {
  near(fromDeg(toUV(4, 180)), 180, 0.5);
  near(fromDeg(toUV(4, 45)), 45, 0.5);
  assert.equal(compassTh(180), 'ใต้');
  assert.equal(compassTh(225), 'ตะวันตกเฉียงใต้');
  assert.equal(compassTh(359), 'เหนือ');
  assert.equal(compassTh(-10), 'เหนือ');
});

test('gridPoints runs south→north, west→east, matching the array order of a field', () => {
  const p = gridPoints({ lat0: 13, lng0: 100, step: 0.5, ny: 2, nx: 3 });
  assert.deepEqual(p, [[13, 100], [13, 100.5], [13, 101], [13.5, 100], [13.5, 100.5], [13.5, 101]]);
});

const spec = { lat0: 13, lng0: 100, step: 1, ny: 2, nx: 2 };

test('sample interpolates between grid points and returns null outside the grid', () => {
  const f = { ...spec, u: [0, 2, 0, 2], v: [0, 0, 4, 4] };
  const mid = sample(f, 13.5, 100.5);
  near(mid[0], 1); near(mid[1], 2);
  assert.deepEqual(sample(f, 13, 100).map((x) => Math.round(x)), [0, 0]);
  assert.equal(sample(f, 12.9, 100.5), null);
  assert.equal(sample(f, 13.5, 101.2), null);
  assert.equal(sample(null, 13, 100), null);
});

test('a missing corner (land for a sea current) makes the sample null instead of a made-up value', () => {
  const f = { ...spec, u: [0, 2, null, 2], v: [0, 0, null, 4] };
  assert.equal(sample(f, 13.5, 100.5), null);
});

test('buildField converts readings and keeps nulls; validShare counts the points with a value', () => {
  const f = buildField(spec, [{ speed: 4, deg: 180, from: true }, null, { speed: 2, deg: 90, from: true }, { speed: null, deg: 10, from: true }]);
  assert.equal(f.u.length, 4);
  assert.equal(f.u[1], null);
  assert.equal(f.v[3], null);
  assert.equal(validShare(f), 0.5);
  near(speedOf([3, 4]), 5);
  assert.equal(speedOf(null), null);
});

test('words and colours follow the speed', () => {
  assert.equal(windWord(0.2), 'ลมสงบ');
  assert.equal(windWord(4), 'ลมปานกลาง');
  assert.equal(windWord(20), 'ลมแรงมาก');
  assert.equal(colorFor(WIND_COLORS, 1), '#5b9bd5');
  assert.equal(colorFor(WIND_COLORS, 30), '#7b2cbf');
});
