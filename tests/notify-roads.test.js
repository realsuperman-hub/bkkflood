import test from 'node:test';
import assert from 'node:assert/strict';
import { roadKey, sanitizeRoads, currentRoad, decideRoad, nextRoadState, buildRoadMessage, MIN_ROAD_GAP_MS, MAX_ROADS } from '../src/lib/notify-roads.js';

const now = 1_000_000_000_000;
const seg = (n, p = {}) => ({ properties: { n, d: 30, a: 0, s: 0, c: 80, u: now - 600e3, v: [2, 2, 1, 0], ...p } });
const cur = (o = {}) => ({ depth: 30, closed: false, conf: 80, upd: now, v: [2, 2, 1, 0], ...o });

test('roadKey is stable, Firestore-safe and different for different names', () => {
  assert.equal(roadKey('ถนนรามคำแหง'), roadKey('ถนนรามคำแหง'));
  assert.notEqual(roadKey('ถนนรามคำแหง'), roadKey('ถนนลาดพร้าว'));
  assert.match(roadKey('ซอย พัฒนาการ 61'), /^r[0-9a-z]+$/);
});

test('sanitizeRoads trims, dedupes, clamps the threshold and keeps at most 5', () => {
  const out = sanitizeRoads([
    { name: '  ถนนก ', min: 20 }, { name: 'ถนนก', min: 30 }, { name: '', min: 20 }, { name: 'ถนนข', min: 'x' }, { name: 'ถนนค', min: 999 }, { name: 'ถนนง', min: 1 },
    { name: 'จ', min: 10 }, { name: 'ฉ', min: 10 }, { name: 'ช', min: 10 },
  ]);
  assert.deepEqual(out.map((r) => r.name), ['ถนนก', 'ถนนค', 'ถนนง', 'จ', 'ฉ']);
  assert.equal(out.length, MAX_ROADS);
  assert.deepEqual(out.map((r) => r.min), [20, 150, 5, 10, 10]);
  assert.deepEqual(sanitizeRoads('x'), []);
});

test('currentRoad takes the deepest segment, any closure, and the worst verdicts', () => {
  const c = currentRoad([seg('ถนนก', { d: 10 }), seg('ถนนก', { d: 45, a: 1, v: [3, 3, 3, 3] }), seg('ถนนอื่น', { d: 99 })], 'ถนนก');
  assert.equal(c.depth, 45);
  assert.equal(c.closed, true);
  assert.deepEqual(c.v, [3, 3, 3, 3]);
  assert.deepEqual(currentRoad([], 'ถนนก'), { depth: 0, closed: false, conf: 0, upd: 0, v: [0, 0, 0, 0], sensor: null, sensorUnknown: false });
});

test('notify once when the threshold is reached, not again while it stays above', () => {
  assert.equal(decideRoad(undefined, cur({ depth: 25 }), { now, min: 20 }).notify, true);
  assert.equal(decideRoad(undefined, cur({ depth: 15 }), { now, min: 20 }).notify, false);
  assert.equal(decideRoad({ on: true, at: now - 1 }, cur({ depth: 60 }), { now, min: 20 }).notify, false);
});

test('a closure notifies even below the threshold and through the cooldown', () => {
  assert.equal(decideRoad(undefined, cur({ depth: 5, closed: true }), { now, min: 20, lastRoadSentAt: now - 1000 }).notify, true);
});

test('cooldown suppresses (and remembers to fire later); a low-confidence estimate stays quiet unless it is far above the threshold', () => {
  const s = decideRoad(undefined, cur({ depth: 25 }), { now, min: 20, lastRoadSentAt: now - MIN_ROAD_GAP_MS / 2 });
  assert.deepEqual([s.notify, s.suppressed], [false, true]);
  assert.deepEqual(nextRoadState(undefined, cur({ depth: 25 }), { suppressed: true, now, min: 20 }), { on: false, at: 0 });
  assert.equal(decideRoad(undefined, cur({ depth: 25, conf: 20 }), { now, min: 20 }).notify, false);
  assert.equal(decideRoad(undefined, cur({ depth: 45, conf: 20 }), { now, min: 20 }).notify, true);
});

test('state: on after a notification, re-armed once the water is below half the threshold', () => {
  const on = nextRoadState(undefined, cur(), { notified: true, now, min: 20 });
  assert.deepEqual(on, { on: true, at: now });
  assert.equal(nextRoadState(on, cur({ depth: 12 }), { now, min: 20 }).on, true); // still wet: stay armed-off
  assert.equal(nextRoadState(on, cur({ depth: 8 }), { now, min: 20 }).on, false); // receded: re-arm
  assert.equal(nextRoadState(on, cur({ depth: 0, closed: true }), { now, min: 20 }).on, true); // closed counts as still flooded
});

test('message names the road, the depth and the verdicts, and links back to it', () => {
  const m = buildRoadMessage('ถนนรามคำแหง', cur({ depth: 45 }));
  assert.match(m.title, /ถนนรามคำแหง: น้ำท่วมราว 45 ซม./);
  assert.match(m.body, /รถเก๋ง: เสี่ยง/);
  assert.equal(m.url, `/?road=${encodeURIComponent('ถนนรามคำแหง')}`);
  assert.match(buildRoadMessage('ถนนก', cur({ closed: true })).title, /ปิดการจราจร/);
});

// ---- BMA depth sensors (POPNIX) on a followed road
const sensor = (o = {}) => ({ c: 'S1', n: 'ถ.ตัวอย่าง (หน้าตลาด)', r: 'ถนนก', la: 13.7, ln: 100.6, cm: 20, lv: 'flood', k: 1, g: 1, t: now - 5 * 60e3, s: now - 30 * 60e3, ...o });

test('a sensor that has been in flood for 10+ minutes counts as a measured depth, trusted without the estimate', () => {
  const c = currentRoad([], 'ถนนก', { sensors: [sensor({ cm: 25 })], now });
  assert.equal(c.depth, 25);
  assert.equal(c.conf, 100);
  assert.equal(c.sensor.cm, 25);
  assert.deepEqual(c.v, [3, 2, 1, 1]); // 25 cm: motorbike blocked, sedan risky, pickup/truck caution
  assert.equal(c.sensorUnknown, false);
  assert.equal(decideRoad(undefined, c, { now, min: 20 }).notify, true);
});

test('sensor and estimate: the deeper and the worse verdict win', () => {
  const c = currentRoad([seg('ถนนก', { d: 40, c: 90, v: [3, 3, 2, 1] })], 'ถนนก', { sensors: [sensor({ cm: 20 })], now });
  assert.equal(c.depth, 40);
  assert.deepEqual(c.v, [3, 3, 2, 1]);
});

test('a brand-new flood reading, a stale one, an offline one and a dry one never alert', () => {
  const none = (s) => currentRoad([], 'ถนนก', { sensors: [s], now });
  assert.equal(none(sensor({ s: now - 3 * 60e3 })).sensor, null); // only 3 min above flood level
  assert.equal(none(sensor({ s: null })).sensor, null);
  assert.equal(none(sensor({ t: now - 2 * 3600e3 })).sensor, null); // reading older than 45 min
  assert.equal(none(sensor({ lv: 'off', cm: null })).sensor, null);
  assert.equal(none(sensor({ lv: 'dry', cm: 2, s: null })).depth, 0);
  assert.equal(decideRoad(undefined, none(sensor({ s: now - 3 * 60e3 })), { now, min: 20 }).notify, false);
});

test('sensors on other roads are ignored; road names are matched loosely (brackets, spaces)', () => {
  assert.equal(currentRoad([], 'ถนนก', { sensors: [sensor({ r: 'ถนนข' })], now }).sensor, null);
  const c = currentRoad([], 'ถนนวิภาวดีขาออก', { sensors: [sensor({ r: 'ถนนวิภาวดี(ขาออก)' })], now });
  assert.equal(c.sensor.cm, 20);
});

test('a road whose sensors have all gone quiet is "unknown": an alert already on does not re-arm', () => {
  const c = currentRoad([], 'ถนนก', { sensors: [sensor({ t: now - 2 * 3600e3 })], now });
  assert.equal(c.sensorUnknown, true);
  assert.equal(nextRoadState({ on: true, at: 1 }, c, { notified: false, suppressed: false, now, min: 20 }).on, true);
  const dry = currentRoad([], 'ถนนก', { sensors: [sensor({ cm: 1, lv: 'dry', s: null })], now });
  assert.equal(dry.sensorUnknown, false);
  assert.equal(nextRoadState({ on: true, at: 1 }, dry, { notified: false, suppressed: false, now, min: 20 }).on, false);
});

test('the sensor message says what was measured, where, and credits the source; it falls back to the estimate message below the threshold', () => {
  const c = currentRoad([], 'ถนนก', { sensors: [sensor({ cm: 20, g: 2 })], now });
  const m = buildRoadMessage('ถนนก', c, 20);
  assert.match(m.title, /เซ็นเซอร์ กทม\. วัดน้ำได้ อย่างน้อย 20 ซม\./);
  assert.match(m.body, /หน้าตลาด/);
  assert.match(m.body, /POPNIX/);
  assert.match(m.body, /อาจลึกกว่า/);
  assert.equal(m.url, '/?road=' + encodeURIComponent('ถนนก'));
  const est = buildRoadMessage('ถนนก', c, 50); // threshold 50 > sensor 20: the generic message
  assert.match(est.title, /น้ำท่วมราว/);
});
