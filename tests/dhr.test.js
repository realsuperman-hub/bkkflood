import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDhr, dhrHls, isDhrHls } from '../src/lib/dhr-cams.js';
import { isCamId, placeLabel } from '../src/lib/maholan-cams.js';

test('normalizeDhr keeps valid cameras as live HLS entries in Chonburi and drops bad ones', () => {
  const out = normalizeDhr([
    { id: 1, lat: 13.4068, lng: 101.0464, name: '  สี่แยกไฟแดง  ดอนหัวฬ่อ ', playlistId: 'stream_1' },
    { id: 1, lat: 13.4, lng: 101.0, name: 'dup', playlistId: 'stream_1' }, // duplicate id
    { id: 2, lat: 13.4, lng: 101.0, name: 'bad playlist', playlistId: '../etc/passwd' },
    { id: 3, lat: 'x', lng: 101.0, name: 'bad lat', playlistId: 'stream_3' },
    { id: 4, lat: 13.41, lng: 101.04, name: 'ok', playlistId: 'stream_4' },
  ]);
  assert.deepEqual(out.map((c) => c.id), ['dhr-1', 'dhr-4']);
  assert.equal(out[0].n, 'สี่แยกไฟแดง ดอนหัวฬ่อ');
  assert.equal(out[0].hls, 'https://cctv.dhr.go.th/hls/stream_1.m3u8');
  assert.equal(out[0].p, 'ชลบุรี');
  assert.equal(placeLabel(out[0]), 'จ.ชลบุรี');
  assert.ok(isCamId(out[0].id));
  assert.deepEqual(normalizeDhr(null), []);
});

test('only the municipality\'s own playlist shape may be opened by the player', () => {
  assert.equal(dhrHls('stream_12'), 'https://cctv.dhr.go.th/hls/stream_12.m3u8');
  assert.equal(dhrHls('stream_x'), null);
  assert.equal(isDhrHls('https://cctv.dhr.go.th/hls/stream_3.m3u8'), true);
  assert.equal(isDhrHls('https://evil.example/hls/stream_3.m3u8'), false);
  assert.equal(isDhrHls('https://cctv.dhr.go.th/hls/stream_3.m3u8?x=1'), false);
  assert.equal(isDhrHls('javascript:alert(1)'), false);
});
