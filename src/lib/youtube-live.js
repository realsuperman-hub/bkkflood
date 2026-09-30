// Live YouTube streams from Thailand that look like cameras (city, road, river, flood). Found with the official YouTube Data API v3
// (search.list → videos.list), shown through YouTube's own embedded player, always labelled "unverified": anyone can start a stream,
// and we cannot moderate what they show. DOM-free (used by scripts/fetch-youtube-live.mjs and the browser).
//
// Quota: the free allowance is 10,000 units/day; search.list costs 100 units, videos.list 1. The fetch script runs at most once an hour
// with 3 searches (~7,300 units/day).

export const API = 'https://www.googleapis.com/youtube/v3';
export const QUERIES = ['กล้อง CCTV สด น้ำท่วม', 'กล้องจราจร สด ถนน', 'กล้อง แม่น้ำ เจ้าพระยา สด'];

export const searchUrl = (q, key) =>
  `${API}/search?part=snippet&type=video&eventType=live&regionCode=TH&relevanceLanguage=th&maxResults=25&q=${encodeURIComponent(q)}&key=${key}`;
export const videosUrl = (ids, key) => `${API}/videos?part=snippet,status,liveStreamingDetails&id=${ids.join(',')}&key=${key}`;

// Streams whose title says they are a camera/flood/traffic/river view. Music, games and chat streams also carry "live", so this filter matters.
const RELEVANT = /กล้อง|cctv|cam\b|webcam|live cam|จราจร|ถนน|น้ำท่วม|ระดับน้ำ|แม่น้ำ|เจ้าพระยา|เขื่อน|คลอง|สะพาน|แยก|traffic|flood|river|bridge|street/i;

// searchItems: items from search.list; videoItems: items from videos.list for the same ids
export function normalizeLive(searchItems, videoItems, now = Date.now()) {
  const info = new Map((videoItems || []).map((v) => [v.id, v]));
  const out = [];
  const seen = new Set();
  for (const s of searchItems || []) {
    const id = s.id?.videoId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const v = info.get(id);
    if (!v) continue;
    const live = v.liveStreamingDetails || {};
    if (v.status?.embeddable !== true || v.status?.privacyStatus !== 'public') continue; // the player would refuse, or it is not public
    if (live.actualEndTime) continue; // already ended
    if (!live.actualStartTime) continue; // scheduled, not live yet
    const title = String(v.snippet?.title || '').trim();
    if (!RELEVANT.test(title)) continue;
    out.push({
      id,
      title: title.slice(0, 120),
      channel: String(v.snippet?.channelTitle || '').slice(0, 60),
      thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
      viewers: Number.isFinite(+live.concurrentViewers) ? +live.concurrentViewers : null,
      startedAt: Date.parse(live.actualStartTime) || null,
    });
  }
  return out.sort((a, b) => (b.viewers ?? -1) - (a.viewers ?? -1) || (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 30);
}
