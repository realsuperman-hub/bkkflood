import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalog, snapUrl, frameIsUsable, sameSpot, isCamId } from '../src/lib/maholan-cams.js';

const cam = (id, o = {}) => ({ id, name: 'แยกทดสอบ', lat: 13.75, lng: 100.52, source: 'iTIC', district: 'ปทุมวัน', ...o });

test('normalizeCatalog keeps cameras with valid id + coordinates inside the metro box, once each', () => {
  const out = normalizeCatalog([
    cam('a'),
    cam('a'), // duplicate id
    cam('b', { lat: undefined, lng: undefined }), // no coordinates
    cam('c', { lat: 18.79, lng: 98.98 }), // Chiang Mai
    cam('../evil'), // id that could break out of the URL
    cam('d', { name: '  ถนน   พระราม 4  ' }),
  ]);
  assert.deepEqual(out.map((x) => x.id), ['a', 'd']);
  assert.equal(out[1].n, 'ถนน พระราม 4');
  assert.deepEqual(Object.keys(out[0]).sort(), ['d', 'id', 'lat', 'lng', 'n', 's']);
});

test('snapUrl uses the shared time bucket and encodes the id', () => {
  assert.equal(snapUrl('tehx-04a196fd', 60000), 'https://cctv.maholan.net/api/snap/tehx-04a196fd?t=2');
  assert.equal(snapUrl('tehx-04a196fd', 89999), snapUrl('tehx-04a196fd', 60000));
  assert.notEqual(snapUrl('x', 0), snapUrl('x', 30000));
  assert.ok(isCamId('itic-doh-per-6-007') && !isCamId('a/b') && !isCamId(''));
});

test('frameIsUsable rejects failed, tiny and long-stale frames but accepts unknown age', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(frameIsUsable({ status: 200, bytes: 11773, imageTime: 'Thu, 01 Oct 2026 11:30:00 GMT' }, now), true);
  assert.equal(frameIsUsable({ status: 502, bytes: 0 }, now), false);
  assert.equal(frameIsUsable({ status: 200, bytes: 300 }, now), false);
  assert.equal(frameIsUsable({ status: 200, bytes: 9000, imageTime: 'Mon, 27 Aug 2026 10:00:00 GMT' }, now), false); // 34 days old
  assert.equal(frameIsUsable({ status: 200, bytes: 9000 }, now), true);
});

test('sameSpot groups cameras on one pole and leaves a camera 100 m away out', () => {
  const cams = normalizeCatalog([cam('c2', { name: 'X-CAM2' }), cam('c1', { name: 'X-CAM1' }), cam('far', { lat: 13.7512 })]);
  const g = sameSpot(cams, cams.find((x) => x.id === 'c1'));
  assert.deepEqual(g.map((x) => x.id), ['c1', 'c2']);
});
