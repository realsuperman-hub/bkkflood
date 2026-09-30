// Live Thai camera-like YouTube streams → public/data/youtube-live.json (official YouTube Data API v3; key = env YOUTUBE_API_KEY).
// Quota-friendly: if the copy that is already live is < 60 min old it is reused and NO API call is made (the workflow runs every ~15 min).
// The key is never printed; errors come from the API's JSON message, not from the request URL.
import { mkdir, writeFile } from 'node:fs/promises';
import { queriesFor, searchUrl, videosUrl, normalizeLive } from '../src/lib/youtube-live.js';

const KEY = process.env.YOUTUBE_API_KEY;
const OUT = 'public/data/youtube-live.json';
const LIVE = 'https://bkkflood.web.app/data/youtube-live.json';
const MAX_AGE_MS = 60 * 60e3;

await mkdir('public/data', { recursive: true });

// reuse the live copy while it is fresh; otherwise remember which streams it listed so they are re-checked (1 unit) without searching again
let known = [];
try {
  const res = await fetch(LIVE, { signal: AbortSignal.timeout(15000) });
  if (res.ok) {
    const cur = await res.json();
    if (process.env.YOUTUBE_FORCE !== 'true' && cur?.generatedAt && Date.now() - cur.generatedAt < MAX_AGE_MS) {
      await writeFile(OUT, JSON.stringify(cur));
      console.log(`youtube-live: live copy is ${Math.round((Date.now() - cur.generatedAt) / 60000)} min old — reused, no API call`);
      process.exit(0);
    }
    known = (cur?.items || []).map((i) => i.id);
  }
} catch {
  /* no live copy yet */
}

if (!KEY) {
  console.log('youtube-live: no YOUTUBE_API_KEY — nothing to do');
  process.exit(1);
}

const api = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${j.error?.message || j.error?.errors?.[0]?.reason || 'error'}`);
  return j;
};

const search = [];
for (const q of queriesFor()) search.push(...((await api(searchUrl(q, KEY))).items || []));
search.push(...known.map((id) => ({ id: { videoId: id } }))); // streams found earlier: still live? (checked by videos.list)
const ids = [...new Set(search.map((s) => s.id?.videoId).filter(Boolean))].slice(0, 50);
const videos = ids.length ? (await api(videosUrl(ids, KEY))).items || [] : [];
const items = normalizeLive(search, videos);

await writeFile(OUT, JSON.stringify({ generatedAt: Date.now(), source: 'YouTube (ค้นหาสตรีมสดในไทยที่ชื่อเกี่ยวกับกล้อง/จราจร/น้ำ)', checked: ids.length, items }));
console.log(`youtube-live: ${ids.length} live candidates → ${items.length} embeddable camera-like streams`);
