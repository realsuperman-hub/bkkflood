import test from 'node:test';
import assert from 'node:assert/strict';
import { looseRoad, sameRoad, sensorsOnRoad, followableRoadNames, thaiTimeMs, normalizePopnixRoads, normalizePopnixCanals, roadCurrent, canalCurrent, canalLevel, roadLevel, nearby, summarize, POPNIX_STALE_MS } from '../src/lib/popnix.js';

const NOW = Date.parse('2026-10-02T15:10:00Z'); // 22:10 Thai time
const MIN = 60e3;
const road = (o = {}) => ({ code: 'FL.A', kind: 1, grp: 1, name: 'ถ.ตัวอย่าง', district: 'บางเขน', lat: 13.8, lng: 100.6, depth: 12, measured_at: '2026-10-02 22:05:00', level: 'flood', since: '2026-10-02 20:00:00', ...o });
const canal = (o = {}) => ({ id: 1, name: 'ค.ตัวอย่าง', river: 'คลองตัวอย่าง', lat: 13.77, lng: 100.62, warn: 0.5, crit: 0.8, bank: 1.5, wl: 0.9, measured_at: '2026-10-02 22:00:00', online: true, level: 'crit', trend: 'up', ...o });

test('POPNIX wall-clock times are read as Thai time', () => {
  assert.equal(thaiTimeMs('2026-10-02 22:05:00'), Date.parse('2026-10-02T15:05:00Z'));
  assert.equal(thaiTimeMs('2026-10-02T22:05'), Date.parse('2026-10-02T15:05:00Z'));
  assert.equal(thaiTimeMs(null), null);
  assert.equal(thaiTimeMs('junk'), null);
});

test('road sensors are compacted, null depth stays null (not 0) and outside-Bangkok rows are dropped', () => {
  const r = normalizePopnixRoads({ roads: [road(), road({ code: 'B', depth: null, level: 'off' }), road({ code: 'X', lat: 18.8, lng: 98.9 }), road({ code: 'T', kind: 2, grp: 2 })] });
  assert.deepEqual(r.map((x) => x.c), ['FL.A', 'B', 'T']);
  assert.equal(r[0].cm, 12);
  assert.equal(r[1].cm, null);
  assert.equal(r[2].k, 2);
  assert.equal(r[2].g, 2);
  assert.equal(r[0].s, Date.parse('2026-10-02T13:00:00Z'));
});

test('a road reading is current only with a value, not off, and fresh', () => {
  const [a, b, c] = normalizePopnixRoads({ roads: [road(), road({ depth: null }), road({ measured_at: '2026-10-02 21:00:00' })] });
  assert.equal(roadCurrent(a, NOW), true);
  assert.equal(roadCurrent(b, NOW), false);
  assert.equal(roadCurrent(c, NOW), false); // 70 min old
  assert.equal(roadLevel(c, NOW), 'stale');
  assert.equal(roadLevel(a, NOW), 'flood');
  assert.equal(POPNIX_STALE_MS, 45 * MIN);
});

test('an offline canal gauge never counts as a live alarm, even if its last level was critical', () => {
  const [on, off, old] = normalizePopnixCanals({ stations: [canal(), canal({ id: 2, online: false }), canal({ id: 3, measured_at: '2026-10-02 13:35:00' })] });
  assert.equal(canalLevel(on, NOW), 'crit');
  assert.equal(canalLevel(off, NOW), 'stale');
  assert.equal(canalLevel(old, NOW), 'stale');
  assert.equal(canalCurrent(old, NOW), false);
});

test('unknown level strings fall back to none/off instead of being trusted', () => {
  assert.equal(normalizePopnixCanals({ stations: [canal({ level: 'weird' })] })[0].lv, 'none');
  assert.equal(normalizePopnixRoads({ roads: [road({ level: 'weird' })] })[0].lv, 'off');
});

test('nearby sorts by distance and respects the radius', () => {
  const cs = normalizePopnixCanals({ stations: [canal({ id: 1, lat: 13.77, lng: 100.62 }), canal({ id: 2, lat: 13.78, lng: 100.62 }), canal({ id: 3, lat: 13.9, lng: 100.62 })] });
  const n = nearby(cs, 13.771, 100.62, 2);
  assert.deepEqual(n.map((x) => x.id), [1, 2]);
  assert.ok(n[0].km < 0.2);
});

test('summarize counts only current readings', () => {
  const roads = normalizePopnixRoads({ roads: [road({ depth: 20 }), road({ code: 'B', depth: 12 }), road({ code: 'C', level: 'slight', depth: 7 }), road({ code: 'D', measured_at: '2026-10-02 10:00:00' })] });
  const canals = normalizePopnixCanals({ stations: [canal(), canal({ id: 2, online: false }), canal({ id: 3, level: 'warn', wl: 0.6 })] });
  const s = summarize(roads, canals, NOW);
  assert.deepEqual(s.roads.flooded.map((r) => r.c), ['FL.A', 'B']); // deepest first
  assert.equal(s.roads.slight, 1);
  assert.equal(s.roads.current, 3);
  assert.equal(s.canals.crit, 1);
  assert.equal(s.canals.warn, 1);
  assert.equal(s.canals.current, 2);
});

test('sensors keep the road they sit on, and road names compare loosely', () => {
  const r = normalizePopnixRoads({ roads: [road({ road: ' ถนนวิภาวดี(ขาออก) ' })] });
  assert.equal(r[0].r, 'ถนนวิภาวดี(ขาออก)');
  assert.equal(looseRoad('ถนน วิภาวดี-รังสิต'), 'ถนนวิภาวดีรังสิต');
  assert.equal(sameRoad('ถนนวิภาวดี(ขาออก)', 'ถนนวิภาวดีขาออก'), true);
  assert.equal(sameRoad('', ''), false);
  assert.deepEqual(sensorsOnRoad(r, 'ถนนวิภาวดีขาออก').length, 1);
  assert.deepEqual(sensorsOnRoad(r, 'ถนนอื่น'), []);
});

test('followable roads = Floodboard names + sensor roads, one entry per road', () => {
  const sensors = normalizePopnixRoads({ roads: [road({ road: 'ถนนหลวงแพ่ง' }), road({ code: 'B', road: 'ถนนบางนา-ตราด' }), road({ code: 'C', road: 'ถนนบางนา ตราด' })] });
  const names = followableRoadNames(['ถนนหลวงแพ่ง', 'ซอยคู้บอน 10'], sensors);
  assert.deepEqual(names, ['ถนนหลวงแพ่ง', 'ซอยคู้บอน 10', 'ถนนบางนา-ตราด']);
});
