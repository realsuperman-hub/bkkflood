import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, nextState, sanitizePlaces, placeKey, buildMessage, heaviestNearbyRain, MIN_GAP_MS, RISK_ALERTS, RAIN_ALERT_MM, RAIN_REARM_MM, RAIN_RADIUS_KM } from '../src/lib/notify-logic.js';

const now = 1_000_000_000_000;
const inB = (la, ln) => la > 13.3 && la < 14.4 && ln > 99.9 && ln < 101.1;

test('first sighting at "prepare" or worse notifies; "watch" does not', () => {
  assert.equal(decide(undefined, { level: 2, heavy: 0 }, { now, riskAlerts: true }).notify, true);
  assert.equal(decide(undefined, { level: 1, heavy: 0 }, { now, riskAlerts: true }).notify, false);
  assert.equal(decide(undefined, { level: 0, heavy: 0 }, { now, riskAlerts: true }).notify, false);
});
test('only escalation notifies; steady or falling does not', () => {
  assert.equal(decide({ level: 2, heavy: 0 }, { level: 2, heavy: 0 }, { now, riskAlerts: true }).notify, false);
  assert.equal(decide({ level: 3, heavy: 0 }, { level: 2, heavy: 0 }, { now, riskAlerts: true }).notify, false);
  assert.equal(decide({ level: 2, heavy: 0 }, { level: 3, heavy: 0 }, { now, riskAlerts: true }).notify, true);
});
test('a new heavy complaint nearby notifies even when the score is low', () => {
  const d = decide({ level: 0, heavy: 0 }, { level: 1, heavy: 2 }, { now, riskAlerts: true });
  assert.equal(d.notify, true);
  assert.equal(d.kind, 'observed');
  assert.equal(decide({ level: 1, heavy: 2 }, { level: 1, heavy: 2 }, { now, riskAlerts: true }).notify, false);
});
test('cooldown suppresses repeats but not a jump into danger', () => {
  const recent = now - MIN_GAP_MS / 2;
  const s = decide({ level: 0, heavy: 0 }, { level: 2, heavy: 0 }, { now, lastSentAt: recent, riskAlerts: true });
  assert.deepEqual([s.notify, s.suppressed], [false, true]);
  assert.equal(decide({ level: 2, heavy: 0 }, { level: 3, heavy: 0 }, { now, lastSentAt: recent, riskAlerts: true }).notify, true);
  assert.equal(decide({ level: 0, heavy: 0 }, { level: 2, heavy: 0 }, { now, lastSentAt: now - MIN_GAP_MS - 1, riskAlerts: true }).notify, true);
});
test('state: suppressed keeps the old baseline; a drop lowers it so re-escalation notifies again', () => {
  const prev = { level: 0, heavy: 0, at: 5 };
  assert.deepEqual(nextState(prev, { level: 2, heavy: 1 }, { suppressed: true, now }), { level: 0, heavy: 0, rainOn: false, at: 5 });
  assert.deepEqual(nextState({ level: 3, heavy: 2, at: 5 }, { level: 1, heavy: 0 }, { now }), { level: 1, heavy: 0, rainOn: false, at: 5 });
  assert.deepEqual(nextState(prev, { level: 2, heavy: 0 }, { notified: true, now }), { level: 2, heavy: 0, rainOn: false, at: now });
});
test('sanitizePlaces drops junk, out-of-area points and caps the list', () => {
  const out = sanitizePlaces([{ lat: 13.75, lng: 100.5, label: 'บ้าน'.repeat(20) }, { lat: 'x', lng: 1 }, { lat: 40, lng: 100 }, null, ...Array(6).fill({ lat: 13.8, lng: 100.6 })], inB);
  assert.equal(out.length, 4);
  assert.equal(out[0].label.length, 20);
  assert.equal(sanitizePlaces('nope', inB).length, 0);
  assert.equal(placeKey({ lat: 13.75, lng: 100.5 }), 'p137500_1005000');
});

test('buildMessage: risk vs observed, deep link to the point', () => {
  const place = { lat: 13.75, lng: 100.5, label: 'บ้าน' };
  const ev = { nearby: { heavy: 2 }, risk: { label: 'เตรียมย้ายของ', advice: 'ย้ายรถ', reasons: [{ text: 'ฝนพยากรณ์ 24 ชม. ≈ 70 มม.' }] } };
  const a = buildMessage(place, ev, 'risk');
  assert.equal(a.title, 'บ้าน: เตรียมย้ายของ');
  assert.match(a.body, /ฝนพยากรณ์/);
  assert.equal(a.url, '/?p=13.75000,100.50000');
  const b = buildMessage(place, ev, 'observed');
  assert.match(b.title, /น้ำท่วมหนักใกล้บ้าน/);
  assert.match(b.body, /2 จุด/);
  assert.notEqual(a.tag, b.tag);
});

test('score-driven alerts are paused by default; observed heavy complaints and the cooldown still work', () => {
  assert.equal(RISK_ALERTS, false);
  assert.equal(decide(undefined, { level: 3, heavy: 0 }, { now }).notify, false); // danger by score alone: silent
  assert.equal(decide({ level: 0, heavy: 0 }, { level: 3, heavy: 0 }, { now }).notify, false);
  const d = decide({ level: 0, heavy: 0 }, { level: 3, heavy: 2 }, { now });
  assert.deepEqual([d.notify, d.kind, d.dangerJump], [true, 'observed', false]); // a real heavy report nearby still alerts
  assert.equal(decide({ level: 0, heavy: 0 }, { level: 1, heavy: 2 }, { now, lastSentAt: now - 1000 }).suppressed, true);
});

// ---- heavy rain measured near a saved place
const km = (a, b, c, d) => Math.hypot((c - a) * 111.2, (d - b) * 111.2 * Math.cos((a * Math.PI) / 180));
const g = (lat, lng, r1, o = {}) => ({ lat, lng, r1, stale: false, name: 'สถานีทดสอบ', ...o });

test('heaviestNearbyRain: the heaviest fresh gauge within the radius; stale, missing and far gauges are ignored', () => {
  const gauges = [g(13.75, 100.5, 12), g(13.76, 100.5, 41), g(13.752, 100.5, 90, { stale: true }), g(13.752, 100.5, null), g(14.2, 100.5, 99), g(13.75, 100.51, 35, { name: 'ใกล้กว่า' })];
  const h = heaviestNearbyRain(gauges, 13.75, 100.5, km);
  assert.equal(h.r1, 41);
  assert.ok(h.km <= RAIN_RADIUS_KM);
  assert.equal(heaviestNearbyRain([g(14.2, 100.5, 99)], 13.75, 100.5, km), null);
  assert.equal(heaviestNearbyRain([], 13.75, 100.5, km), null);
});

test('measured heavy rain notifies once, is not paused with the score alerts, and re-arms only when it eases', () => {
  const heavy = { level: 0, heavy: 0, rain: RAIN_ALERT_MM };
  const d = decide(undefined, heavy, { now });
  assert.deepEqual([d.notify, d.kind], [true, 'rain']); // riskAlerts is off by default
  assert.equal(decide(undefined, { ...heavy, rain: RAIN_ALERT_MM - 1 }, { now }).notify, false);
  const s1 = nextState(undefined, heavy, { notified: true, suppressed: false, now });
  assert.equal(s1.rainOn, true);
  assert.equal(decide(s1, heavy, { now }).notify, false); // still pouring: no repeat
  assert.equal(nextState(s1, { ...heavy, rain: RAIN_REARM_MM + 5 }, { notified: false, suppressed: false, now }).rainOn, true); // eased a bit, still above the re-arm level: stays on
  assert.equal(nextState(s1, { ...heavy, rain: RAIN_REARM_MM - 1 }, { notified: false, suppressed: false, now }).rainOn, false); // eased: re-armed
  assert.equal(decide({ ...s1, rainOn: false }, heavy, { now }).notify, true);
});

test('the cooldown holds a rain alert back and keeps it for later; a complaint alert outranks the kind label', () => {
  const heavy = { level: 0, heavy: 0, rain: 50 };
  const d = decide(undefined, heavy, { now, lastSentAt: now - 30 * 60e3 });
  assert.deepEqual([d.notify, d.suppressed], [false, true]);
  assert.equal(nextState(undefined, heavy, { notified: false, suppressed: true, now }).rainOn, false); // fires on a later run
  assert.equal(decide(undefined, { level: 0, heavy: 2, rain: 50 }, { now }).kind, 'observed');
});

test('the rain message names the place, the gauge, the amount and the distance, and says it is one gauge', () => {
  const m = buildMessage({ lat: 13.75, lng: 100.5, label: 'บ้าน' }, { risk: {}, nearby: {} }, 'rain', { r1: 42.2, name: 'พนมสารคาม', km: 3.46 });
  assert.equal(m.title, 'ฝนตกหนักใกล้บ้าน');
  assert.match(m.body, /พนมสารคาม/);
  assert.match(m.body, /42\.2 มม\./);
  assert.match(m.body, /3\.5 กม\./);
  assert.match(m.body, /สถานีเดียว/);
  assert.match(m.tag, /^rain-p/);
  assert.match(m.url, /^\/\?p=13\.75000,100\.50000$/);
});
