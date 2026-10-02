import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceStatuses, overallStatus, toMs, OK, SLOW, OLD, MISSING, LOADING } from '../src/lib/source-status.js';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const ago = (ms) => NOW - ms;
const MIN = 60e3, H = 3600e3, D = 24 * H;
const f = (u) => ({ properties: { u } });

const fresh = () => ({
  stations: [{ t: ago(20 * MIN), upstream: false }, { t: ago(5 * D), upstream: true }],
  stationsAt: ago(5 * MIN),
  floods: [{ id: 1 }], floodsAt: ago(10 * MIN),
  rainObs: [{ t: ago(30 * MIN) }], rainObsAt: ago(5 * MIN),
  roadFlood: { generatedAt: ago(8 * MIN), features: [f(ago(10 * MIN))] },
  overview: { rain: {}, tide: {}, at: ago(MIN) },
  traffic: { eventsAt: ago(10 * MIN), roadsAt: ago(10 * MIN), dds: { reportDate: '2026-10-01' } },
  dams: { date: '2026-10-02' }, satFlood: { lastPass: '2026-09-29' }, news: { generatedAt: ago(H) },
  mcams: { generatedAt: ago(5 * H) }, mcamAi: { generatedAt: ago(30 * MIN) },
});
const by = (list) => Object.fromEntries(list.map((x) => [x.id, x.level]));

test('toMs reads numbers, ISO strings and plain dates, and rejects junk', () => {
  assert.equal(toMs(1790000000000), 1790000000000);
  assert.equal(toMs('2026-10-02'), Date.parse('2026-10-02'));
  assert.equal(toMs('2026-10-02 14:35'), Date.parse('2026-10-02T14:35'));
  assert.equal(toMs(null), null);
  assert.equal(toMs('x'), null);
  assert.equal(toMs(0), null);
});

test('everything fresh → all ok, and the overall line says so', () => {
  const l = sourceStatuses(fresh(), NOW);
  assert.ok(l.every((x) => x.level === OK), JSON.stringify(by(l)));
  assert.deepEqual(overallStatus(l), { tone: 'ok', text: 'แหล่งข้อมูลอัปเดตปกติ', labels: [] });
});

test('upstream gauges do not count: only the newest metro reading matters', () => {
  const s = fresh();
  s.stations = [{ t: ago(3 * H), upstream: false }, { t: ago(10 * MIN), upstream: true }];
  assert.equal(by(sourceStatuses(s, NOW)).stations, SLOW); // 3 h old metro gauges, even though an upstream one is fresh
  s.stations[0].t = ago(7 * H);
  assert.equal(by(sourceStatuses(s, NOW)).stations, OLD);
});

test('a stalled snapshot is slow, then old; the overall line names the core sources and how bad it is', () => {
  const s = fresh();
  s.floodsAt = ago(90 * MIN);
  let l = sourceStatuses(s, NOW);
  assert.equal(by(l).floods, SLOW);
  assert.deepEqual(overallStatus(l).tone, 'warn');
  assert.match(overallStatus(l).text, /ล่าช้า: จุดน้ำท่วมที่ประชาชนแจ้ง/);
  s.floodsAt = ago(4 * H);
  l = sourceStatuses(s, NOW);
  assert.equal(by(l).floods, OLD);
  assert.equal(overallStatus(l).tone, 'bad');
  assert.match(overallStatus(l).text, /ไม่อัปเดต/);
});

test('our road copy can be fresh while the upstream readings inside it are hours old', () => {
  const s = fresh();
  s.roadFlood = { generatedAt: ago(5 * MIN), features: [f(ago(8 * H))] };
  const r = sourceStatuses(s, NOW).find((x) => x.id === 'roads');
  assert.equal(r.level, SLOW);
  assert.match(r.note, /ต้นทาง/);
});

test('extra sources only soften the line; a missing source is a problem unless the page is still loading', () => {
  const s = fresh();
  s.traffic.dds = { reportDate: '2026-09-25' }; // a week old, like the real BMA report was
  s.mcamAi = { generatedAt: ago(5 * H) };
  const l = sourceStatuses(s, NOW);
  assert.equal(by(l).dds, OLD);
  assert.equal(by(l).ai, OLD);
  assert.deepEqual(overallStatus(l), { tone: 'warn', text: 'แหล่งข้อมูลหลักอัปเดตปกติ · บางแหล่งเสริมล่าช้า', labels: [] });
  const none = sourceStatuses({ stations: [], rainObs: [], floods: [], traffic: {} }, NOW);
  assert.equal(by(none).stations, MISSING);
  const loading = sourceStatuses({ stations: [], rainObs: [], floods: [], traffic: {} }, NOW, { loading: true });
  assert.equal(by(loading).stations, LOADING);
  assert.equal(overallStatus(loading).tone, 'ok'); // nothing is called a problem while loading
});

test('forecast: both models present is ok, one missing is slow, none is old', () => {
  const s = fresh();
  s.overview = { rain: {}, tide: null, at: NOW };
  assert.equal(by(sourceStatuses(s, NOW)).forecast, SLOW);
  s.overview = { rain: null, tide: null, at: NOW };
  assert.equal(by(sourceStatuses(s, NOW)).forecast, OLD);
});

test('the routing service appears once it has been used, and a failure shows', () => {
  const s = fresh();
  assert.equal(sourceStatuses(s, NOW).some((x) => x.id === 'route'), false);
  s.routeSvc = { ok: false, at: NOW };
  assert.equal(by(sourceStatuses(s, NOW)).route, OLD);
});
