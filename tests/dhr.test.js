import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDhr, dhrPlaylist, isDhrPage, DHR_PAGE } from '../src/lib/dhr-cams.js';
import { isCamId, placeLabel } from '../src/lib/maholan-cams.js';

test('normalizeDhr keeps valid cameras as location + link entries in Chonburi and drops bad ones', () => {
  const out = normalizeDhr([
    { id: 1, lat: 13.4068, lng: 101.0464, name: '  สี่แยกไฟแดง  ดอนหัวฬ่อ ', playlistId: 'stream_1' },
    { id: 1, lat: 13.4, lng: 101.0, name: 'dup', playlistId: 'stream_1' }, // duplicate id
    { id: 2, lat: 13.4, lng: 101.0, name: 'bad playlist', playlistId: '../etc/passwd' },
    { id: 3, lat: 'x', lng: 101.0, name: 'bad lat', playlistId: 'stream_3' },
    { id: 4, lat: 13.41, lng: 101.04, name: 'ok', playlistId: 'stream_4' },
  ]);
  assert.deepEqual(out.map((c) => c.id), ['dhr-1', 'dhr-4']);
  assert.equal(out[0].n, 'สี่แยกไฟแดง ดอนหัวฬ่อ');
  assert.equal(out[0].link, DHR_PAGE);
  assert.equal(out[0].p, 'ชลบุรี');
  assert.equal(placeLabel(out[0]), 'จ.ชลบุรี');
  assert.ok(isCamId(out[0].id));
  assert.equal('hls' in out[0], false); // we never carry a stream address to the site
  assert.deepEqual(normalizeDhr(null), []);
});

test('the playlist address is only built for the owner\'s own stream names; only the owner\'s page may be linked', () => {
  assert.equal(dhrPlaylist('stream_12'), 'https://cctv.dhr.go.th/hls/stream_12.m3u8');
  assert.equal(dhrPlaylist('stream_x'), null);
  assert.equal(isDhrPage('https://cctv.dhr.go.th/'), true);
  assert.equal(isDhrPage('https://evil.example/'), false);
  assert.equal(isDhrPage('javascript:alert(1)'), false);
});
