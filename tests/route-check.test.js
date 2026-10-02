import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOsrm, densify, checkRoute, rankRoutes, segVerdict, osrmUrl } from '../src/lib/route-check.js';

// a flooded road along y=13.75 from x=100.600 to 100.606 (~650 m) and a perpendicular one crossing at x=100.603
const flood = (name, coords, p = {}) => ({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [coords] }, properties: { n: name, d: 30, a: 0, s: 0, c: 80, u: 0, v: [2, 2, 1, 0], ...p } });
const along = flood('ถนนตามทาง', [[100.6, 13.75], [100.606, 13.75]]);
const cross = flood('ซอยตัด', [[100.603, 13.7485], [100.603, 13.7515]]);
const far = flood('ถนนไกล', [[100.6, 13.76], [100.606, 13.76]]);
const route = [[100.598, 13.75], [100.608, 13.75]];

test('parseOsrm reads routes and rejects errors', () => {
  const r = parseOsrm({ code: 'Ok', routes: [{ distance: 1234.4, duration: 300, geometry: { coordinates: [[100.6, 13.7], [100.61, 13.71]] } }, { distance: 1, duration: 1, geometry: { coordinates: [[100.6, 13.7]] } }] });
  assert.equal(r.length, 1);
  assert.equal(r[0].distanceM, 1234);
  assert.throws(() => parseOsrm({ code: 'NoRoute', message: 'x' }), /x/);
  assert.match(osrmUrl({ lat: 13.7, lng: 100.5 }, { lat: 13.8, lng: 100.6 }), /100\.50000,13\.70000;100\.60000,13\.80000\?overview=full/);
});

test('densify puts a point at least every 12 m', () => {
  const d = densify([[100.6, 13.75], [100.601, 13.75]], 12); // ~108 m
  assert.ok(d.length >= 9 && d.length <= 11);
});

test('checkRoute finds the flooded road the route runs along, not the far one, and ignores a bare junction touch', () => {
  const c = checkRoute([along, cross, far], route, 1);
  assert.deepEqual(c.groups.map((g) => g.name), ['ถนนตามทาง']);
  assert.ok(c.floodedM >= 560 && c.floodedM <= 700, String(c.floodedM));
  assert.equal(c.worst, 2); // sedan: risky
  assert.equal(c.hits.length, 1);
});

test('the verdict follows the vehicle; a closed road blocks everything and a small-car closure blocks cars', () => {
  assert.equal(checkRoute([along], route, 3).worst, 0); // truck passes
  assert.equal(checkRoute([along], route, 0).worst, 2);
  assert.equal(segVerdict({ a: 1, v: [0, 0, 0, 0] }, 3), 3);
  assert.equal(segVerdict({ s: 1, v: [0, 0, 0, 0] }, 1), 3);
  assert.equal(segVerdict({ s: 1, v: [0, 0, 0, 0] }, 2), 0);
});

test('rankRoutes prefers the route with the least bad verdict, then less flooded length, then time', () => {
  const mk = (worst, floodedM, durationS) => ({ durationS, check: { worst, floodedM } });
  assert.deepEqual(rankRoutes([mk(2, 100, 10), mk(0, 0, 50), mk(0, 0, 30), mk(1, 5, 5)]), [2, 1, 3, 0]);
});

test('a route with no flooded roads on it reports nothing', () => {
  const c = checkRoute([far], route, 1);
  assert.equal(c.worst, 0);
  assert.equal(c.groups.length, 0);
});
