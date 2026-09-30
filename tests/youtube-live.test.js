import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLive, searchUrl, queriesFor, QUERY_SETS } from '../src/lib/youtube-live.js';

const s = (id) => ({ id: { videoId: id } });
const v = (id, o = {}) => ({
  id,
  snippet: { title: 'กล้องจราจร สด แยกปทุมวัน', channelTitle: 'ช่องทดสอบ', thumbnails: { medium: { url: `https://i.ytimg.com/${id}.jpg` } }, ...o.snippet },
  status: { embeddable: true, privacyStatus: 'public', ...o.status },
  liveStreamingDetails: { actualStartTime: '2026-09-30T10:00:00Z', concurrentViewers: '42', ...o.live },
});

test('normalizeLive keeps embeddable, public, currently-live, camera-like streams, most watched first', () => {
  const search = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'a'].map(s);
  const vids = [
    v('a'),
    v('b', { live: { concurrentViewers: '500' } }),
    v('c', { status: { embeddable: false } }), // the player would refuse
    v('d', { live: { actualEndTime: '2026-09-30T11:00:00Z' } }), // ended
    v('e', { snippet: { title: 'เพลงฮิตรวมมิตร ฟังสบาย' } }), // not a camera
    v('f', { live: { actualStartTime: undefined } }), // scheduled, not started
    v('g', { status: { privacyStatus: 'unlisted' } }),
    v('h', { snippet: { title: 'Live Streaming, Traffic Camera, Car Spotting', channelTitle: 'Friant Roulette' } }), // relevant words but not Thai
    v('i', { snippet: { title: 'Bangkok Sukhumvit traffic cam', channelTitle: 'BKK Cam' } }), // English title but a Thai place
  ];
  const out = normalizeLive(search, vids);
  assert.deepEqual(out.map((x) => x.id), ['i', 'b', 'a']); // Bangkok first (local), then by viewers 500, 42
  assert.equal(out[0].local, true);
  assert.equal(out[1].viewers, 500);
  assert.equal(out[1].local, false);
  assert.equal(out[2].thumb, 'https://i.ytimg.com/a.jpg');
});

test('searchUrl asks for live Thai videos and encodes the query', () => {
  const u = searchUrl('กล้อง สด', 'K');
  assert.ok(u.includes('eventType=live') && u.includes('regionCode=TH') && u.includes('type=video'));
  assert.ok(u.includes(encodeURIComponent('กล้อง สด')));
  assert.ok(u.endsWith('&key=K'));
});

test('query sets rotate by hour and every set is 3 short queries', () => {
  assert.ok(QUERY_SETS.every((q) => q.length === 3));
  const h = (n) => n * 3600e3;
  assert.notDeepEqual(queriesFor(h(1)), queriesFor(h(2)));
  assert.deepEqual(queriesFor(h(3)), queriesFor(h(0)));
});
