import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRain, nearestRain, observedAround, intensity1h, intensity24h } from '../src/lib/rain-obs.js';

const row = (o = {}) => ({
  id: 1, rain_24h: 12.5, rain_1h: 3, rainfall_datetime: '2026-09-29 23:00',
  station: { id: o.sid ?? 9, tele_station_name: { th: ' สถานีทดสอบ ' }, tele_station_lat: o.lat ?? 13.8, tele_station_long: o.lng ?? 100.6 },
  geocode: { province_name: { th: 'กรุงเทพมหานคร' } }, agency: { agency_shortname: { th: 'สสน.' } }, ...(o.r || {}),
});
const now = Date.parse('2026-09-30T00:10:00+07:00');

test('normalizeRain keeps nearby gauges, parses numbers and Bangkok time, flags stale/negative/missing', () => {
  const raw = { data: [
    row(),
    row({ sid: 10, lat: 18.7, lng: 98.9 }), // Chiang Mai → out of area
    row({ sid: 11, r: { rain_1h: null } }), // 24h only
    row({ sid: 12, r: { rain_24h: -1, rain_1h: -1 } }), // sensor error codes → dropped
    row({ sid: 13, r: { rainfall_datetime: '2026-09-29 12:00' } }), // stale
    (() => { const r = row({ sid: 14 }); r.station.tele_station_lat = null; return r; })(), // no coordinates
  ] };
  const g = normalizeRain(raw, now);
  assert.deepEqual(g.map((x) => x.id), [9, 11, 13]);
  assert.equal(g[0].name, 'สถานีทดสอบ');
  assert.equal(g[0].r1, 3);
  assert.equal(g[0].stale, false);
  assert.equal(g[1].r1, null);
  assert.equal(g[2].stale, true);
  assert.throws(() => normalizeRain({}), /unexpected/);
});

test('nearest / observedAround ignore stale gauges and far ones', () => {
  const g = normalizeRain({ data: [row({ sid: 1, r: { rain_1h: 4 } }), row({ sid: 2, lat: 13.81, lng: 100.61, r: { rain_1h: 22, rain_24h: 95 } }), row({ sid: 3, r: { rainfall_datetime: '2026-09-29 12:00', rain_1h: 90 } }), row({ sid: 4, lat: 14.3, lng: 101.0, r: { rain_1h: 50 } })] }, now);
  const near = nearestRain(g, 13.8, 100.6, { maxKm: 12 });
  assert.ok(near.every((x) => x.km <= 12) && !near.some((x) => x.id === 4));
  const o = observedAround(g, 13.8, 100.6);
  assert.equal(o.r1, 22, 'max of fresh gauges; the stale 90 mm is ignored');
  assert.equal(o.r24, 95);
  assert.equal(observedAround(g, 13.4, 101.0), null);
});

test('intensity classes', () => {
  assert.equal(intensity1h(0).label, 'ไม่มีฝน');
  assert.equal(intensity1h(12).label, 'ฝนหนัก');
  assert.equal(intensity1h(31).label, 'ฝนหนักมาก');
  assert.equal(intensity24h(50).label, 'ฝนหนัก');
  assert.equal(intensity24h(120).label, 'ฝนหนักมาก');
});
