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
  assert.deepEqual(currentRoad([], 'ถนนก'), { depth: 0, closed: false, conf: 0, upd: 0, v: [0, 0, 0, 0] });
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
