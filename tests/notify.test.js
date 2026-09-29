import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, nextState, sanitizePlaces, placeKey, buildMessage, MIN_GAP_MS } from '../src/lib/notify-logic.js';

const now = 1_000_000_000_000;
const inB = (la, ln) => la > 13.3 && la < 14.4 && ln > 99.9 && ln < 101.1;

test('first sighting at "prepare" or worse notifies; "watch" does not', () => {
  assert.equal(decide(undefined, { level: 2, heavy: 0 }, { now }).notify, true);
  assert.equal(decide(undefined, { level: 1, heavy: 0 }, { now }).notify, false);
  assert.equal(decide(undefined, { level: 0, heavy: 0 }, { now }).notify, false);
});
test('only escalation notifies; steady or falling does not', () => {
  assert.equal(decide({ level: 2, heavy: 0 }, { level: 2, heavy: 0 }, { now }).notify, false);
  assert.equal(decide({ level: 3, heavy: 0 }, { level: 2, heavy: 0 }, { now }).notify, false);
  assert.equal(decide({ level: 2, heavy: 0 }, { level: 3, heavy: 0 }, { now }).notify, true);
});
test('a new heavy complaint nearby notifies even when the score is low', () => {
  const d = decide({ level: 0, heavy: 0 }, { level: 1, heavy: 2 }, { now });
  assert.equal(d.notify, true);
  assert.equal(d.kind, 'observed');
  assert.equal(decide({ level: 1, heavy: 2 }, { level: 1, heavy: 2 }, { now }).notify, false);
});
test('cooldown suppresses repeats but not a jump into danger', () => {
  const recent = now - MIN_GAP_MS / 2;
  const s = decide({ level: 0, heavy: 0 }, { level: 2, heavy: 0 }, { now, lastSentAt: recent });
  assert.deepEqual([s.notify, s.suppressed], [false, true]);
  assert.equal(decide({ level: 2, heavy: 0 }, { level: 3, heavy: 0 }, { now, lastSentAt: recent }).notify, true);
  assert.equal(decide({ level: 0, heavy: 0 }, { level: 2, heavy: 0 }, { now, lastSentAt: now - MIN_GAP_MS - 1 }).notify, true);
});
test('state: suppressed keeps the old baseline; a drop lowers it so re-escalation notifies again', () => {
  const prev = { level: 0, heavy: 0, at: 5 };
  assert.deepEqual(nextState(prev, { level: 2, heavy: 1 }, { suppressed: true, now }), { level: 0, heavy: 0, at: 5 });
  assert.deepEqual(nextState({ level: 3, heavy: 2, at: 5 }, { level: 1, heavy: 0 }, { now }), { level: 1, heavy: 0, at: 5 });
  assert.deepEqual(nextState(prev, { level: 2, heavy: 0 }, { notified: true, now }), { level: 2, heavy: 0, at: now });
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
