import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOsrm, densify, checkRoute, rankRoutes, segVerdict, osrmUrl, gmapsUrl, waypointsOf, depthVerdict } from '../src/lib/route-check.js';

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

test('Google Maps hand-over: origin, destination, driving, and two waypoints only on longer trips', () => {
  const long = [[100.5, 13.7], [100.55, 13.72], [100.6, 13.74], [100.65, 13.76], [100.7, 13.78]]; // ~25 km
  const u = new URL(gmapsUrl({ lat: 13.7, lng: 100.5 }, { lat: 13.78, lng: 100.7 }, long));
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(u.searchParams.get('origin'), '13.70000,100.50000');
  assert.equal(u.searchParams.get('destination'), '13.78000,100.70000');
  assert.equal(u.searchParams.get('travelmode'), 'driving');
  assert.equal(u.searchParams.get('waypoints').split('|').length, 2);
  const short = [[100.5, 13.7], [100.51, 13.7]]; // ~1 km
  assert.equal(new URL(gmapsUrl({ lat: 13.7, lng: 100.5 }, { lat: 13.7, lng: 100.51 }, short)).searchParams.has('waypoints'), false);
  assert.deepEqual(waypointsOf(short), []);
});

// POPNIX depth sensors: { c, n, la, ln, cm, lv, k, g, t, s }
const NOW = Date.parse('2026-10-02T15:10:00Z');
const sensor = (o = {}) => ({ c: 'S1', n: 'เซ็นเซอร์ตัวอย่าง', d: '', la: 13.75, ln: 100.603, cm: 22, lv: 'flood', k: 1, g: 1, t: NOW - 5 * 60e3, s: null, ...o });

test('depthVerdict: the same depth is worse for a lower vehicle', () => {
  assert.deepEqual([0, 1, 2, 3].map((v) => depthVerdict(22, v)), [2, 2, 1, 1]);
  assert.deepEqual([0, 1, 2, 3].map((v) => depthVerdict(3, v)), [0, 0, 0, 0]);
  assert.equal(depthVerdict(30, 1), 3);
  assert.equal(depthVerdict(60, 3), 3);
});

test('a measured sensor on the route counts even where the flood estimate has nothing, and sets the verdict for the vehicle', () => {
  const c = checkRoute([], route, 1, { sensors: [sensor()], now: NOW });
  assert.equal(c.groups.length, 0);
  assert.equal(c.sensors.list.length, 1);
  assert.equal(c.worst, 2); // 22 cm, sedan
  assert.equal(checkRoute([], route, 3, { sensors: [sensor()], now: NOW }).worst, 1); // truck: caution
});

test('sensors off the route (more than 35 m away) are ignored', () => {
  const c = checkRoute([], route, 1, { sensors: [sensor({ la: 13.7508 })], now: NOW }); // ~90 m north
  assert.equal(c.sensors.list.length, 0);
  assert.equal(c.worst, 0);
});

test('dry and stale sensors never raise the verdict; they are counted so the sheet can say "no value is not dry"', () => {
  const c = checkRoute([], route, 1, { sensors: [sensor({ cm: 2, lv: 'dry' }), sensor({ c: 'S2', t: NOW - 3 * 3600e3 }), sensor({ c: 'S3', cm: null, lv: 'off' })], now: NOW });
  assert.equal(c.sensors.list.length, 0);
  assert.equal(c.sensors.dry, 1);
  assert.equal(c.sensors.stale, 2);
  assert.equal(c.worst, 0);
});

test('the worst of the estimate and the sensors wins, and sensors reorder the ranking', () => {
  const withSensor = { check: checkRoute([along], route, 1, { sensors: [sensor({ cm: 35 })], now: NOW }), durationS: 600 }; // estimate risky, sensor blocked
  assert.equal(withSensor.check.worst, 3);
  const clean = { check: checkRoute([], [[100.598, 13.755], [100.608, 13.755]], 1, { sensors: [sensor()], now: NOW }), durationS: 900 };
  assert.deepEqual(rankRoutes([withSensor, clean]), [1, 0]);
});

test('without a sensor list checkRoute behaves as before', () => {
  const c = checkRoute([along], route, 1);
  assert.deepEqual(c.sensors, { list: [], worst: 0, dry: 0, stale: 0 });
  assert.equal(c.worst, 2);
});
