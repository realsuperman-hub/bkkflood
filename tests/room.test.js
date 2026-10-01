import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAi, activeFlags, AI_STALE_MS } from '../src/lib/maholan-ai.js';
import { pickCams, districtList } from '../src/lib/room-pick.js';

const NOW = Date.parse('2026-10-01T12:00:00Z');
const det = (id, o = {}) => ({ id, flood: true, level: 'moderate', confidence: 0.95, at: NOW - 60000, floodUntil: NOW + 3600e3, ...o });

test('normalizeAi keeps real findings and drops the "image would not load" pseudo-flags', () => {
  const out = normalizeAi({ detections: [
    det('a'),
    det('b', { level: 'none', confidence: 0 }), // flood:true but not a finding
    det('c', { confidence: 0.5 }), // too unsure
    det('d', { floodUntil: NOW - 1 }), // expired
    det('e', { flood: false }),
    det('../x'),
    det('f', { level: 'severe', confidence: 0.8 }),
  ], progress: { scanned: 595, total: 1898 } }, NOW);
  assert.deepEqual(out.flags.map((f) => f.id), ['a', 'f']);
  assert.equal(out.scanned, 595);
  assert.equal(out.total, 1898);
});

test('activeFlags ignores a stale file and expired verdicts', () => {
  const file = { generatedAt: NOW - 3600e3, flags: [{ id: 'a', level: 'moderate', conf: 0.9, until: NOW + 1000 }, { id: 'b', level: 'moderate', conf: 0.9, until: NOW - 1000 }] };
  assert.deepEqual([...activeFlags(file, NOW).keys()], ['a']);
  assert.equal(activeFlags({ ...file, generatedAt: NOW - AI_STALE_MS - 1 }, NOW).size, 0);
  assert.equal(activeFlags(null, NOW).size, 0);
});

const cam = (id, n, d, lat = 13.75, lng = 100.52) => ({ id, n, d, lat, lng, s: 'x' });
const cams = [cam('1', 'ข', 'บางเขน'), cam('2', 'ก', 'บางเขน'), cam('3', 'ค', 'ปทุมวัน', 13.7463, 100.5302), cam('4', 'ง', '', 14.5, 101)];

test('pickCams: nothing chosen shows only AI-flagged and favourite cameras, flagged first', () => {
  const ai = new Map([['3', {}]]);
  assert.deepEqual(pickCams(cams, { ai, favs: new Set(['1']) }).map((c) => c.id), ['3', '1']);
  assert.deepEqual(pickCams(cams, {}).map((c) => c.id), []);
});

test('pickCams: a district lists its cameras by name, AI-flagged on top; "*" lists all', () => {
  assert.deepEqual(pickCams(cams, { district: 'บางเขน' }).map((c) => c.id), ['2', '1']);
  assert.deepEqual(pickCams(cams, { district: 'บางเขน', ai: new Map([['1', {}]]) }).map((c) => c.id), ['1', '2']);
  assert.equal(pickCams(cams, { district: '*' }).length, 4);
});

test('pickCams: near-me sorts by distance within 12 km and needs a position', () => {
  assert.deepEqual(pickCams(cams, { district: '@' }), []);
  const here = { lat: 13.7463, lng: 100.5302 };
  assert.deepEqual(pickCams(cams, { district: '@', here }).map((c) => c.id), ['3', '2', '1']); // 1 and 2 share a pole (tie → by name); 4 is ~100 km away
});

test('pickCams: aiOnly / favOnly override the district', () => {
  assert.deepEqual(pickCams(cams, { district: 'บางเขน', aiOnly: true, ai: new Map([['3', {}]]) }).map((c) => c.id), ['3']);
  assert.deepEqual(pickCams(cams, { district: '*', favOnly: true, favs: new Set(['4']) }).map((c) => c.id), ['4']);
});

test('districtList counts cameras per district and skips cameras without one', () => {
  assert.deepEqual(districtList(cams), [{ name: 'บางเขน', n: 2 }, { name: 'ปทุมวัน', n: 1 }]);
});
