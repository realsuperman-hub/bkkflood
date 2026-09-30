import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebcams, isWindyPlayer } from '../src/lib/windy-cams.js';

const cam = (o = {}) => ({
  webcamId: 1302885774,
  title: '  Khlong Khwang Subdistrict: Phayathai, Bangkok ',
  status: 'active',
  lastUpdatedOn: '2026-09-30T19:29:45.000Z',
  location: { latitude: 13.7563412, longitude: 100.5018, city: 'Khlong Khwang Subdistrict', region: 'Bangkok' },
  player: { day: 'https://webcams.windy.com/webcams/public/embed/player/1302885774/day', month: 'x' },
  urls: { detail: 'https://www.windy.com/webcams/1302885774' },
  ...o,
});

test('normalizeWebcams keeps active cameras that have an embeddable timelapse and drops everything else', () => {
  const out = normalizeWebcams([
    cam(),
    cam({ webcamId: 2, status: 'inactive' }),
    cam({ webcamId: 3, player: {} }), // no timelapse to embed
    cam({ webcamId: 4, player: { day: 'http://evil.example/x' } }), // not a Windy player URL
    cam({ webcamId: 5, location: { latitude: null, longitude: 100 } }),
    cam({ webcamId: 6, urls: { detail: 'https://evil.example/' } }), // detail link that is not windy.com is dropped, camera kept
  ]);
  assert.deepEqual(out.map((c) => c.id), ['1302885774', '6']);
  assert.equal(out[0].title, 'Khlong Khwang Subdistrict: Phayathai, Bangkok');
  assert.equal(out[0].lat, 13.75634);
  assert.equal(out[0].detail, 'https://www.windy.com/webcams/1302885774');
  assert.equal(out[1].detail, null);
  assert.equal(out[0].updated, Date.parse('2026-09-30T19:29:45.000Z'));
});

test('isWindyPlayer only accepts https webcams.windy.com URLs', () => {
  assert.equal(isWindyPlayer('https://webcams.windy.com/webcams/public/embed/player/1/day'), true);
  assert.equal(isWindyPlayer('https://webcams.windy.com.evil.example/x'), false);
  assert.equal(isWindyPlayer('javascript:alert(1)'), false);
  assert.equal(isWindyPlayer(null), false);
});
